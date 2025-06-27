import * as cv from '@u4/opencv4nodejs';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface BubbleDetectionOptions {
  bubbleCount: number;
  optionsPerQuestion?: number;
  questionsPerColumn?: number;
  numberOfColumns?: number;
  minArea?: number;
  maxArea?: number;
  fillThreshold?: number;
  debug?: boolean;
  deskew?: boolean;
}

export interface BubbleResult {
  marked: number[]; // global bubble indices
  perQuestion: { 
    question: number; 
    selected: string[] // Changed from number[] to string[] for letter options
  }[];
  debugOverlayPath?: string;
  warning?: string;
  debug?: Array<{
    idx: number;
    fill?: number;
    cx?: number;
    cy?: number;
    bbox: { left: number; top: number; size: number };
  }>;
}

type Bubble = {
  idx: number;
  cnt: cv.Contour;
  area: number;
  center: { x: number; y: number };
  bbox: { x: number; y: number; width: number; height: number };
  colIdx: number;
  rowIdx: number;
};

export class ImageRecognitionService {
  static readonly OUTPUT_DIR = path.join(process.cwd(), 'public/scans');
  static readonly BUBBLE_MIN_AREA = 200;
  static readonly BUBBLE_MAX_AREA = 5000;
  static readonly FILL_THRESHOLD = 80;
  static readonly OPTIONS_PER_QUESTION = 4;

  static async analyzeCoverImage(
    image: Buffer,
    options: BubbleDetectionOptions
  ): Promise<BubbleResult> {
    const {
      bubbleCount,
      optionsPerQuestion = ImageRecognitionService.OPTIONS_PER_QUESTION,
      questionsPerColumn = 10,
      numberOfColumns = 3,
      minArea = ImageRecognitionService.BUBBLE_MIN_AREA,
      maxArea = ImageRecognitionService.BUBBLE_MAX_AREA,
      fillThreshold = ImageRecognitionService.FILL_THRESHOLD,
      debug,
      deskew = false,
    } = options;

    // 1. Normalize image to PNG, get raw buffer
    const sharpImg = sharp(image).ensureAlpha();
    const meta = await sharpImg.metadata();
    const raw = await sharpImg.raw().toBuffer();
    const mat = new cv.Mat(raw, meta.height!, meta.width!, cv.CV_8UC4);

    // 2. Preprocess: grayscale, blur, threshold
    const gray = mat.cvtColor(cv.COLOR_RGBA2GRAY);
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
    const binary = blurred.adaptiveThreshold(
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      21,
      10
    );

    // 3. Find contours (potential bubbles)
    const contours = binary.findContours(
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    // 4. Filter contours by area/circularity
    const bubbles: Bubble[] = [];
    for (const cnt of contours) {
      const area = cnt.area;
      if (area < minArea || area > maxArea) continue;
      const rect = cnt.boundingRect();
      const aspect = rect.width / rect.height;
      if (aspect < 0.7 || aspect > 1.3) continue;
      const peri = cnt.arcLength(true);
      const circularity = (4 * Math.PI * area) / (peri * peri);
      if (circularity < 0.6) continue;
      bubbles.push({
        idx: -1,
        cnt,
        area,
        center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        bbox: rect,
        colIdx: -1,
        rowIdx: -1,
      });
    }

    // 5. Sort and group bubbles by columns and rows
    const columnWidth = meta.width! / numberOfColumns;
    const rowHeight = meta.height! / questionsPerColumn;

    // Add validation for dimensions
    console.log('Image dimensions:', {
      width: meta.width,
      height: meta.height,
      columnWidth,
      rowHeight
    });

    // First, assign column and rough position to each bubble
    bubbles.forEach(bubble => {
      const colIdx = Math.floor(bubble.center.x / columnWidth);
      const rowIdx = Math.floor(bubble.center.y / rowHeight);
      bubble.colIdx = colIdx;
      bubble.rowIdx = rowIdx;
    });

    // Validate bubble assignments
    const bubbleAssignments = bubbles.reduce((acc, bubble) => {
      const key = `col${bubble.colIdx}row${bubble.rowIdx}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('Bubble assignments per cell:', bubbleAssignments);

    // Group bubbles by question rows
    const questionRows: Bubble[][] = [];
    const bubblesByColumn: Bubble[][] = [];

    // First, separate bubbles into columns
    for (let col = 0; col < numberOfColumns; col++) {
      const colBubbles = bubbles.filter(b => b.colIdx === col);
      bubblesByColumn[col] = colBubbles;
    }

    // For each column
    for (let col = 0; col < numberOfColumns; col++) {
      const colBubbles = bubblesByColumn[col];
      
      // Sort bubbles in this column by Y position
      colBubbles.sort((a, b) => a.center.y - b.center.y);
      
      // Group into rows
      for (let row = 0; row < questionsPerColumn; row++) {
        const startIdx = row * optionsPerQuestion;
        const rowBubbles = colBubbles.slice(startIdx, startIdx + optionsPerQuestion);
        
        if (rowBubbles.length === optionsPerQuestion) {
          // Sort options within row by X position
          rowBubbles.sort((a, b) => a.center.x - b.center.x);
          
          // Calculate correct indices for this row
          const baseIndex = col * (questionsPerColumn * optionsPerQuestion) + (row * optionsPerQuestion);
          rowBubbles.forEach((bubble, optIdx) => {
            bubble.idx = baseIndex + optIdx;
          });
          
          questionRows.push(rowBubbles);
        }
      }
    }

    // Group into questions
    const questionBubbles = questionRows;

    if (questionBubbles.length === 0) {
      throw new Error('No valid question groups found');
    }

    console.log('Found', bubbles.length, 'total bubbles');
    console.log('Created', questionBubbles.length, 'question groups');
    questionBubbles.forEach((group, i) => {
      const colNum = Math.floor(i / questionsPerColumn) + 1;
      const rowNum = (i % questionsPerColumn) + 1;
      console.log(
        `Question ${i + 1} (Column ${colNum}, Row ${rowNum}): ${group.length} options, indices:`,
        group.map(b => ({
          idx: b.idx,
          x: Math.round(b.center.x),
          y: Math.round(b.center.y)
        }))
      );
    });

    const marked: number[] = [];
    const perQuestion: { question: number; selected: string[] }[] = [];
    const debugInfo: BubbleResult['debug'] = [];

    for (let qIdx = 0; qIdx < questionBubbles.length; qIdx++) {
      const group = questionBubbles[qIdx];
      const markedIndices: number[] = [];
      
      const fillPercentages = await Promise.all(group.map(async bubble => {
        const mask = new cv.Mat(binary.rows, binary.cols, cv.CV_8UC1, 0);
        const contourPoints = bubble.cnt.getPoints();
        const contours = [contourPoints];
        const white = new cv.Vec3(255, 255, 255);
        mask.drawContours(contours, 0, white, cv.FILLED);
        
        const rect = bubble.cnt.boundingRect();
        const roi = binary.getRegion(rect);
        const masked = roi.bitwiseAnd(mask.getRegion(rect));
        const mean = cv.mean(masked, mask.getRegion(rect));
        return mean.w;
      }));

      // Second pass: mark bubbles using the adaptive threshold
      const fillStats = {
        min: Math.min(...fillPercentages),
        max: Math.max(...fillPercentages),
        avg: fillPercentages.reduce((a, b) => a + b, 0) / fillPercentages.length
      };

      // Use a more robust threshold calculation
      const effectiveThreshold = Math.min(
        fillThreshold,
        (fillStats.min + fillStats.max) / 2 + 20 // Midpoint + margin
      );

      if (qIdx === 9) { // Question 10
        console.log('Question 10 fill statistics:', {
          fillStats,
          effectiveThreshold,
          fillPercentages
        });
      }

      group.forEach((bubble, idx) => {
        const fillPercentage = fillPercentages[idx];
        if (fillPercentage > effectiveThreshold) {
          marked.push(bubble.idx);
          markedIndices.push(idx);
        }

        if (debug) {
          debugInfo.push({
            idx: bubble.idx,
            fill: fillPercentage,
            cx: bubble.center.x,
            cy: bubble.center.y,
            bbox: {
              left: bubble.bbox.x,
              top: bubble.bbox.y,
              size: Math.max(bubble.bbox.width, bubble.bbox.height),
            },
          });
        }
      });

      // Convert marked indices to letters
      const selected = markedIndices.map(idx => String.fromCharCode(65 + idx));

      // Add validation logging
      if (qIdx === 9) { // Question 10
        console.log('Question 10 processing:', {
          group: group.map(b => b.idx),
          markedIndices,
          selected,
          marked,
          bubbleToLetter: group.map((b, i) => ({
            bubbleIdx: b.idx,
            letter: String.fromCharCode(65 + i)
          }))
        });
      }

      perQuestion.push({ 
        question: qIdx + 1, 
        selected
      });
    }

    // 10. Optionally save debug overlay
    let debugOverlayPath: string | undefined;
    if (debug) {
      await fs.mkdir(ImageRecognitionService.OUTPUT_DIR, { recursive: true });
      const overlayPath = path.join(
        ImageRecognitionService.OUTPUT_DIR,
        `omr_debug_${Date.now()}.png`
      );
      await ImageRecognitionService.saveDebugOverlay(mat, bubbles, marked, overlayPath);
      debugOverlayPath = overlayPath;
    }

    return { marked, perQuestion, debugOverlayPath, debug: debugInfo };
  }

  static async generateDebugOverlay(
    image: Buffer,
    debugInfo: BubbleResult['debug'] = []
  ): Promise<Buffer> {
    const sharpImg = sharp(image).ensureAlpha();
    const meta = await sharpImg.metadata();
    const raw = await sharpImg.raw().toBuffer();
    const mat = new cv.Mat(raw, meta.height!, meta.width!, cv.CV_8UC4);
    
    const overlay = mat.copy();
    for (const bubble of debugInfo) {
      const color = bubble.fill && bubble.fill > ImageRecognitionService.FILL_THRESHOLD
        ? new cv.Vec3(0, 0, 255)  // Red for marked
        : new cv.Vec3(255, 0, 0); // Blue for unmarked
        
      overlay.drawRectangle(
        new cv.Point2(bubble.bbox.left, bubble.bbox.top),
        new cv.Point2(
          bubble.bbox.left + bubble.bbox.size,
          bubble.bbox.top + bubble.bbox.size
        ),
        color,
        2
      );
    }
    
    // Convert back to buffer
    const tempPath = path.join(ImageRecognitionService.OUTPUT_DIR, `temp_${Date.now()}.png`);
    cv.imwrite(tempPath, overlay);
    const buffer = await fs.readFile(tempPath);
    await fs.unlink(tempPath);
    return buffer;
  }

  static async simulateMarkedScan(options: {
    bubbleCount: number;
    marked: number[];
    width?: number;
    height?: number;
  }): Promise<Buffer> {
    const { bubbleCount, marked, width = 600, height = 900 } = options;
    
    // Create blank white image with alpha
    const white = new cv.Vec4(255, 255, 255, 255);
    const black = new cv.Vec4(0, 0, 0, 255);
    const mat = new cv.Mat(height, width, cv.CV_8UC4);
    mat.setTo(white);
    
    // Calculate bubble size and spacing
    const bubbleSize = 30;
    const spacing = 40;
    const cols = Math.min(5, bubbleCount);
    const rows = Math.ceil(bubbleCount / cols);
    
    // Draw bubbles
    for (let i = 0; i < bubbleCount; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = 50 + col * spacing;
      const y = 50 + row * spacing;
      
      // Draw circle
      const color = marked.includes(i + 1) ? black : white;
      const center = new cv.Point2(x + bubbleSize/2, y + bubbleSize/2);
      mat.drawCircle(center, bubbleSize/2, color as cv.Vec3, cv.LINE_8);
      mat.drawCircle(center, bubbleSize/2, black as cv.Vec3, cv.LINE_8);
    }
    
    // Convert to buffer
    const tempPath = path.join(ImageRecognitionService.OUTPUT_DIR, `temp_${Date.now()}.png`);
    await cv.imwriteAsync(tempPath, mat);
    const buffer = await fs.readFile(tempPath);
    await fs.unlink(tempPath);
    return buffer;
  }

  static buildBubbleMap(questions: any[], questionsPerCol = 10, numCols = 3) {
    const bubbleMap: { questionIndex: number; optionIndex: number; label: string }[] = [];
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < questionsPerCol; row++) {
        const qIdx = col * questionsPerCol + row;
        if (qIdx >= questions.length) continue;
        const q = questions[qIdx];
        for (let optIdx = 0; optIdx < (q.options?.length || 0); optIdx++) {
          bubbleMap.push({
            questionIndex: qIdx,
            optionIndex: optIdx,
            label: String.fromCharCode(65 + optIdx),
          });
        }
      }
    }
    return bubbleMap;
  }

  private static async saveDebugOverlay(
    mat: cv.Mat,
    bubbles: Bubble[],
    marked: number[],
    outPath: string
  ) {
    const overlay = mat.copy();
    for (const bubble of bubbles) {
      const color = marked.includes(bubble.idx)
        ? new cv.Vec3(0, 0, 255)  // Red for marked
        : new cv.Vec3(255, 0, 0);  // Blue for unmarked

      // Draw the contour
      const contourPoints = bubble.cnt.getPoints();
      overlay.drawContours([contourPoints], 0, color, 2);

      // Draw the center point
      overlay.drawCircle(
        new cv.Point2(bubble.center.x, bubble.center.y),
        2,
        color,
        -1
      );

      // Draw the bubble index
      overlay.putText(
        bubble.idx.toString(),
        new cv.Point2(bubble.bbox.x, bubble.bbox.y - 5),
        cv.FONT_HERSHEY_SIMPLEX,
        0.5,
        color,
        1
      );
    }
    cv.imwrite(outPath, overlay);
  }
}