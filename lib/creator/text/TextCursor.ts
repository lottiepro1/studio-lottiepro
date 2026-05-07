/**
 * TextCursor.ts — Immutable text editing state + pure cursor manipulation functions.
 *
 * All functions return a NEW TextEditState — never mutate in place.
 * CanvasView keeps one TextEditState in React state and calls these to
 * derive the next state on each keystroke.
 */

export interface TextEditState {
    nodeId: string;
    text: string;
    cursorIndex: number;    // insertion point (same as selectionEnd when no selection)
    selectionStart: number; // anchor of the selection range
    selectionEnd: number;   // active end of the selection range (may be < selectionStart)
    composing: boolean;     // true during IME composition
    compositionText: string;
    originalText: string;   // text value on edit entry — restored by Escape
}

export function createTextEditState(nodeId: string, text: string): TextEditState {
    // Start with cursor at end, full text selected so typing replaces it naturally
    return {
        nodeId,
        text,
        cursorIndex: text.length,
        selectionStart: 0,
        selectionEnd: text.length,
        composing: false,
        compositionText: '',
        originalText: text,
    };
}

function hasSelection(state: TextEditState): boolean {
    return state.selectionStart !== state.selectionEnd;
}

/** Replace the selected range (or insert at cursor) with the given text. */
export function insertText(state: TextEditState, text: string): TextEditState {
    const s = Math.min(state.selectionStart, state.selectionEnd);
    const e = Math.max(state.selectionStart, state.selectionEnd);
    const newText = state.text.slice(0, s) + text + state.text.slice(e);
    const newCursor = s + text.length;
    return {
        ...state,
        text: newText,
        cursorIndex: newCursor,
        selectionStart: newCursor,
        selectionEnd: newCursor,
    };
}

/** Delete the char before the cursor (or the selected range). */
export function deleteBackward(state: TextEditState): TextEditState {
    if (hasSelection(state)) return insertText(state, '');
    if (state.cursorIndex === 0) return state;
    const newText = state.text.slice(0, state.cursorIndex - 1) + state.text.slice(state.cursorIndex);
    const newCursor = state.cursorIndex - 1;
    return { ...state, text: newText, cursorIndex: newCursor, selectionStart: newCursor, selectionEnd: newCursor };
}

/** Delete the char after the cursor (or the selected range). */
export function deleteForward(state: TextEditState): TextEditState {
    if (hasSelection(state)) return insertText(state, '');
    if (state.cursorIndex >= state.text.length) return state;
    const newText = state.text.slice(0, state.cursorIndex) + state.text.slice(state.cursorIndex + 1);
    return { ...state, text: newText };
}

export function moveCursorLeft(state: TextEditState, shift: boolean): TextEditState {
    if (!shift && hasSelection(state)) {
        const collapsed = Math.min(state.selectionStart, state.selectionEnd);
        return { ...state, cursorIndex: collapsed, selectionStart: collapsed, selectionEnd: collapsed };
    }
    const newCursor = Math.max(0, state.cursorIndex - 1);
    if (shift) {
        return { ...state, cursorIndex: newCursor, selectionEnd: newCursor };
    }
    return { ...state, cursorIndex: newCursor, selectionStart: newCursor, selectionEnd: newCursor };
}

export function moveCursorRight(state: TextEditState, shift: boolean): TextEditState {
    if (!shift && hasSelection(state)) {
        const collapsed = Math.max(state.selectionStart, state.selectionEnd);
        return { ...state, cursorIndex: collapsed, selectionStart: collapsed, selectionEnd: collapsed };
    }
    const newCursor = Math.min(state.text.length, state.cursorIndex + 1);
    if (shift) {
        return { ...state, cursorIndex: newCursor, selectionEnd: newCursor };
    }
    return { ...state, cursorIndex: newCursor, selectionStart: newCursor, selectionEnd: newCursor };
}

export function moveCursorHome(state: TextEditState, shift: boolean): TextEditState {
    const lineStart = state.text.lastIndexOf('\n', state.cursorIndex - 1) + 1;
    if (shift) {
        return { ...state, cursorIndex: lineStart, selectionEnd: lineStart };
    }
    return { ...state, cursorIndex: lineStart, selectionStart: lineStart, selectionEnd: lineStart };
}

export function moveCursorEnd(state: TextEditState, shift: boolean): TextEditState {
    const nextNewline = state.text.indexOf('\n', state.cursorIndex);
    const lineEnd = nextNewline === -1 ? state.text.length : nextNewline;
    if (shift) {
        return { ...state, cursorIndex: lineEnd, selectionEnd: lineEnd };
    }
    return { ...state, cursorIndex: lineEnd, selectionStart: lineEnd, selectionEnd: lineEnd };
}

export function selectAll(state: TextEditState): TextEditState {
    return {
        ...state,
        cursorIndex: state.text.length,
        selectionStart: 0,
        selectionEnd: state.text.length,
    };
}

export function getSelectedText(state: TextEditState): string {
    const s = Math.min(state.selectionStart, state.selectionEnd);
    const e = Math.max(state.selectionStart, state.selectionEnd);
    return state.text.slice(s, e);
}
