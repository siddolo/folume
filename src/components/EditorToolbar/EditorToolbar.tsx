import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { strings, formatString } from '../../shared/strings';

export function EditorToolbar({ editor }: { editor: Editor }) {
  useEditorState({ editor, selector: context => context.editor.state });
  const button = ({ label, title }: { label: string; title: string }, action: () => void, active = false, disabled = false) => (
    <button type="button" title={title} aria-label={title} aria-pressed={active} className={active ? 'active' : ''} disabled={disabled}
      onMouseDown={event => event.preventDefault()} onClick={action}>{label}</button>
  );
  const link = () => {
    const href = prompt(strings.dialogs.linkUrl, editor.getAttributes('link').href ?? '');
    if (href === null) return;
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };
  return <div className="toolbar" role="toolbar" aria-label={strings.toolbar.label}>
    <select aria-label={strings.toolbar.paragraphStyle} value={editor.isActive('heading') ? String(editor.getAttributes('heading').level) : '0'}
      onChange={event => {
        const level = Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6;
        if (level) editor.chain().focus().setHeading({ level }).run();
        else editor.chain().focus().setParagraph().run();
      }}>
      <option value="0">{strings.toolbar.paragraph}</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>{formatString(strings.toolbar.heading, { level })}</option>)}
    </select>
    {button(strings.toolbar.bold, () => { editor.chain().focus().toggleBold().run(); }, editor.isActive('bold'))}
    {button(strings.toolbar.italic, () => { editor.chain().focus().toggleItalic().run(); }, editor.isActive('italic'))}
    {button(strings.toolbar.strike, () => { editor.chain().focus().toggleStrike().run(); }, editor.isActive('strike'))}
    {button(strings.toolbar.inlineCode, () => { editor.chain().focus().toggleCode().run(); }, editor.isActive('code'))}
    <span className="toolbar-divider" />
    {button(strings.toolbar.bulletList, () => { editor.chain().focus().toggleBulletList().run(); }, editor.isActive('bulletList'))}
    {button(strings.toolbar.orderedList, () => { editor.chain().focus().toggleOrderedList().run(); }, editor.isActive('orderedList'))}
    {button(strings.toolbar.taskList, () => { editor.chain().focus().toggleTaskList().run(); }, editor.isActive('taskList'))}
    {button(strings.toolbar.blockquote, () => { editor.chain().focus().toggleBlockquote().run(); }, editor.isActive('blockquote'))}
    {button(strings.toolbar.codeBlock, () => { editor.chain().focus().toggleCodeBlock().run(); }, editor.isActive('codeBlock'))}
    {button(strings.toolbar.horizontalRule, () => { editor.chain().focus().setHorizontalRule().run(); })}
    {button(strings.toolbar.hardBreak, () => { editor.chain().focus().setHardBreak().run(); })}
    <span className="toolbar-divider" />
    {button(strings.toolbar.link, link, editor.isActive('link'))}
    {button(strings.toolbar.image, () => {
      const src = prompt(strings.dialogs.imageUrl);
      if (src) editor.chain().focus().setImage({ src, alt: prompt(strings.dialogs.imageAlt) ?? '' }).run();
    })}
    {button(strings.toolbar.table, () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); })}
    {editor.isActive('table') && <>
      {button(strings.toolbar.addRow, () => { editor.chain().focus().addRowAfter().run(); })}
      {button(strings.toolbar.addColumn, () => { editor.chain().focus().addColumnAfter().run(); })}
      {button(strings.toolbar.deleteRow, () => { editor.chain().focus().deleteRow().run(); })}
      {button(strings.toolbar.deleteColumn, () => { editor.chain().focus().deleteColumn().run(); })}
      {button(strings.toolbar.deleteTable, () => { editor.chain().focus().deleteTable().run(); })}
    </>}
    <span className="toolbar-divider" />
    {button(strings.toolbar.undo, () => { editor.chain().focus().undo().run(); }, false, !editor.can().undo())}
    {button(strings.toolbar.redo, () => { editor.chain().focus().redo().run(); }, false, !editor.can().redo())}
  </div>;
}
