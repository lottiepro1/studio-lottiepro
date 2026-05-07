/**
 * wrapLines.ts — Pure word-wrap utility shared by CanvasRenderer (worker) and
 * TextMeasurer (main thread).
 *
 * No DOM dependencies — safe to import in a Web Worker.
 *
 * Algorithm:
 * 1. Split rawText on '\n' (explicit line breaks) — these are always hard breaks.
 * 2. For each paragraph, if maxWidth > 0, split at spaces to fit within maxWidth.
 *    A single word wider than maxWidth is placed on its own line rather than split.
 * 3. Returns WrappedLine[] where startIndex/endIndex are byte offsets into rawText.
 *    This lets TextMeasurer map cursor char indices to the correct visual line.
 */

export interface WrappedLine {
    /** Visual text drawn on this line */
    text: string;
    /** Index of the first character in rawText that belongs to this line */
    startIndex: number;
    /** Index one past the last character in rawText that belongs to this line */
    endIndex: number;
}

/**
 * @param rawText    Full text string (may contain '\n')
 * @param maxWidth   Box width in pixels; 0 means point text (no soft wrapping)
 * @param measureFn  Returns pixel width of a string — wraps ctx.measureText().width
 */
export function wrapLines(
    rawText: string,
    maxWidth: number,
    measureFn: (text: string) => number,
): WrappedLine[] {
    const result: WrappedLine[] = [];
    const paragraphs = rawText.split('\n');
    let offset = 0; // cursor position in rawText

    for (const para of paragraphs) {
        if (maxWidth <= 0 || para === '') {
            // Point text or empty paragraph — no soft wrapping
            result.push({ text: para, startIndex: offset, endIndex: offset + para.length });
            offset += para.length + 1; // +1 for the '\n' that terminated this paragraph
            continue;
        }

        // Pre-compute the rawText position of each word so we can report precise
        // startIndex/endIndex values even after soft wrapping.
        const words = para.split(' ');
        const wordStarts: number[] = [];
        let wo = offset;
        for (const word of words) {
            wordStarts.push(wo);
            wo += word.length + 1; // +1 for the space after this word
        }

        let lineStartWordIdx = 0;
        let currentLine = '';

        for (let wi = 0; wi < words.length; wi++) {
            const candidate = currentLine ? `${currentLine} ${words[wi]}` : words[wi];
            if (measureFn(candidate) > maxWidth && currentLine !== '') {
                // Current word doesn't fit — flush current line, start a new one
                result.push({
                    text: currentLine,
                    startIndex: wordStarts[lineStartWordIdx],
                    endIndex: wordStarts[lineStartWordIdx] + currentLine.length,
                });
                lineStartWordIdx = wi;
                currentLine = words[wi];
            } else {
                currentLine = candidate;
            }
        }

        // Flush the last line of this paragraph
        result.push({
            text: currentLine,
            startIndex: wordStarts[lineStartWordIdx],
            endIndex: wordStarts[lineStartWordIdx] + currentLine.length,
        });

        offset += para.length + 1;
    }

    return result;
}
