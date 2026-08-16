// Matches a .se('path') / .se("path") directive with an optional trailing volume argument,
// supporting backslash-escaped quotes inside the path. Shared verbatim by hoverProvider.ts
// (hover preview) and smdParser.ts (line parsing) — kept identical so hover previews and
// actual playback always agree on what counts as a valid .se() call.
export const SE_DIRECTIVE_MATCH_REGEX = /\.se\(\s*(?:"([^"]+)"|'((?:\\[']|[^'])+)')(?:\s*,\s*([0-9.]+))?\s*\)/i;
