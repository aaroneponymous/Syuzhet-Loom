// Extracting one record (a table row or a headed section) from handoff and design Markdown.
// Shared by trace validation and the staleness report, so both read an item the same way.

/** Table rows that start with the id, and sections headed by it, in the given Markdown. */
export function recordText(md: string, id: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  const rowStart = `| ${id} |`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(rowStart)) out.push(line);
    const h = line.match(/^(#{2,4}) (\S+)/);
    if (h && h[2] === id) {
      const level = h[1].length;
      let j = i + 1;
      while (j < lines.length && !(lines[j].match(/^(#{1,4}) /) && lines[j].match(/^#+/)![0].length <= level)) j++;
      out.push(lines.slice(i, j).join('\n'));
    }
  }
  return out.join('\n');
}
