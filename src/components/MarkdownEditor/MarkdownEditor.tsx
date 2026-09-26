import { useEditor, EditorContent } from '@tiptap/react';
import { useRef } from 'react';
import { strings } from '../../shared/strings';
import { editorExtensions } from './extensions';
import { localReference } from './links';
import { EditorToolbar } from '../EditorToolbar/EditorToolbar';

export function MarkdownEditor({ content, path, onChange, onOpen }: {
  content: string; path: string; onChange: (value: string) => void; onOpen: (path: string) => void;
}) {
  const props = useRef({ path, onChange, onOpen });
  props.current = { path, onChange, onOpen };
  const editor = useEditor({
    extensions: editorExtensions(() => props.current.path),
    content, contentType: 'markdown',
    editorProps: {
      attributes: { class: 'note-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': strings.workspace.visualEditorLabel, spellcheck: 'true' },
      handleClick: (_view, _position, event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        if (!anchor) return false;
        event.preventDefault();
        if (!(event.ctrlKey || event.metaKey)) return true;
        const href = anchor.getAttribute('href') ?? '';
        const local = localReference(href, props.current.path);
        if (local && /\.md$/i.test(local.path)) props.current.onOpen(local.path);
        else if (/^(https?:\/\/|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
        else if (local) window.open(`/api/assets?path=${encodeURIComponent(local.path)}`, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
    onUpdate: ({ editor }) => props.current.onChange(editor.getMarkdown()),
  });
  if (!editor) return null;
  return <><EditorToolbar editor={editor} /><div className="editor-scroll"><EditorContent editor={editor} /></div></>;
}
