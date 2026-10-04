const omittedNote = (count: number) => `\n…[${count} characters omitted]…\n`;

/** Keeps the head and tail of `value` when it is longer than `maxChars`. */
export const truncateMiddle = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  const headChars = Math.ceil(maxChars / 2);
  const tailChars = maxChars - headChars;
  return `${value.slice(0, headChars)}${omittedNote(value.length - maxChars)}${value.slice(value.length - tailChars)}`;
};

/**
 * Collects a line stream (stdout or stderr) and keeps at most `maxChars` of
 * it: the first half and the last half, with a note of what was cut. Memory
 * stays bounded however much the command prints.
 */
export class OutputCollector {
  private dropped = 0;
  private head = '';
  private readonly headLimit: number;
  private started = false;
  private tail = '';
  private readonly tailLimit: number;
  private total = 0;

  constructor(private readonly maxChars: number) {
    this.headLimit = Math.ceil(maxChars / 2);
    this.tailLimit = maxChars - this.headLimit;
  }

  /** Characters received, including any that were cut. */
  get length() {
    return this.total;
  }

  /** Appends one line; lines are joined with a newline. */
  push(line: string) {
    const text = this.started ? `\n${line}` : line;
    this.started = true;
    this.append(text);
  }

  /** Appends raw text, e.g. a decoded chunk of a log body. */
  append(text: string) {
    let rest = text;
    if (!rest) return;
    this.total += rest.length;
    if (this.head.length < this.headLimit) {
      const room = this.headLimit - this.head.length;
      this.head += rest.slice(0, room);
      rest = rest.slice(room);
    }
    if (!rest) return;
    this.tail += rest;
    // Trim in batches so a long stream is not re-sliced on every line.
    if (this.tail.length > this.tailLimit * 2 + 1024) {
      const cut = this.tail.length - this.tailLimit;
      this.dropped += cut;
      this.tail = this.tail.slice(cut);
    }
  }

  toString() {
    if (this.dropped === 0 && this.head.length + this.tail.length <= this.maxChars) {
      return this.head + this.tail;
    }
    const cut = Math.max(0, this.tail.length - this.tailLimit);
    return `${this.head}${omittedNote(this.dropped + cut)}${this.tail.slice(cut)}`;
  }
}
