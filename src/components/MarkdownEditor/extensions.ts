import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { imageSource } from './links';

export function editorExtensions(getPath: () => string) {
  // Only the DOM URL is rewritten. The Markdown node retains the original relative src.
  const LocalImage = Image.extend({
    renderHTML({ HTMLAttributes }) {
      return ['img', { ...HTMLAttributes, src: imageSource(String(HTMLAttributes.src ?? ''), getPath()), loading: 'lazy', referrerpolicy: 'no-referrer' }];
    },
  });
  return [
    StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } } }),
    Markdown, LocalImage, TableKit.configure({ table: { resizable: false } }),
    TaskList, TaskItem.configure({ nested: true }),
  ];
}
