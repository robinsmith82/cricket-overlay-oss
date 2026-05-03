// Bundled .md imports come through wrangler's [[rules]] type="Text" handler
// as raw strings.
declare module '*.md' {
  const content: string;
  export default content;
}
