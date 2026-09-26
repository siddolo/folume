import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../src/components/MarkdownEditor/extensions.js';
import { imageSource, localReference } from '../src/components/MarkdownEditor/links.js';

test('official Tiptap Markdown roundtrip retains standard formatting and relative asset paths', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const markdown = `# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

**bold**, *italic*, ~~strike~~ and \`inline\`.

> A quotation

- bullet
- second

1. ordered
2. another

- [ ] unchecked
- [x] checked

[Local note](../note.md) and [Web](https://example.com).

![Alt](../assets/photo.png "Photo")

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
| --- | --- |
| One | Two |

---

hard  
break
`;
  const editor = new Editor({ extensions: editorExtensions(() => 'notes/test.md'), content: markdown, contentType: 'markdown' });
  try {
    const serialized = editor.getMarkdown();
    for (const expected of ['# Heading 1', '###### Heading 6', '**bold**', '*italic*', '~~strike~~', '`inline`', '> A quotation', '- [ ] unchecked', '- [x] checked', '../note.md', '../assets/photo.png', '```ts', 'One', 'Two']) assert.ok(serialized.includes(expected), expected + '\n' + serialized);
    assert.ok(!serialized.includes('/api/assets'));
    const json = editor.getJSON();
    editor.commands.setContent(serialized, { contentType: 'markdown', emitUpdate: false });
    assert.deepEqual(editor.getJSON(), json);
    assert.match(editor.getHTML(), /src="\/api\/assets\?path=assets%2Fphoto.png"/);
    assert.match(editor.getHTML(), /<br/);
    editor.commands.setContent('<script>alert(1)</script>\n\n![bad](javascript:alert)\n\n[x](javascript:alert)', { contentType: 'markdown' });
    assert.ok(!editor.getHTML().includes('<script>'));
    assert.ok(!editor.getHTML().includes('src="javascript:'));
    assert.ok(!editor.getHTML().includes('href="javascript:'));
  } finally { editor.destroy(); dom.window.close(); }
});

test('link/asset resolution is relative to current note and rejects executable schemes', () => {
  assert.deepEqual(localReference('../Note%20%C3%A8.md#section', 'folder/note.md'), { path: 'Note è.md', hash: '#section' });
  assert.equal(imageSource('../assets/test.png', 'folder/note.md'), '/api/assets?path=assets%2Ftest.png');
  assert.equal(imageSource('https://example.com/image.png', 'a.md'), 'https://example.com/image.png');
  assert.equal(imageSource('javascript:alert(1)', 'a.md'), '');
  assert.equal(imageSource('file:///etc/passwd', 'a.md'), '');
  assert.equal(localReference('.git/config.md', 'a.md'), null);
});
