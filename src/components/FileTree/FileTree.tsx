import { useEffect, useState } from 'react';
import type { FsNode } from '../../shared/filesystem-types';
import { strings } from '../../shared/strings';
import { preference, setPreference } from '../../app/preferences';

export function FileTree({ nodes, current, selected, onSelect, onOpen }: {
  nodes: FsNode[]; current: string | null; selected: string; onSelect: (node: FsNode) => void; onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>(() => preference('expanded', []));
  useEffect(() => {
    if (!current) return;
    const parts = current.split('/');
    setExpanded(previous => Array.from(new Set([...previous, ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))])));
  }, [current]);
  useEffect(() => { setPreference('expanded', expanded); }, [expanded]);
  const render = (items: FsNode[], level = 0) => <ul className="file-tree" aria-label={level === 0 ? strings.sidebar.treeLabel : undefined}>
    {items.map(node => <li key={node.path}>
      <button type="button" className={`tree-row ${current === node.path ? 'current' : ''} ${selected === node.path ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + level * 17 }} title={node.path} aria-current={current === node.path ? 'page' : undefined}
        aria-expanded={node.type === 'directory' ? expanded.includes(node.path) : undefined}
        onClick={() => {
          onSelect(node);
          if (node.type === 'file') onOpen(node.path);
          else setExpanded(previous => previous.includes(node.path) ? previous.filter(path => path !== node.path) : [...previous, node.path]);
        }}>
        <span className="file-icon" aria-hidden="true">{node.type === 'directory' ? expanded.includes(node.path) ? '▾' : '▸' : '≡'}</span>
        <span className="node-name">{node.name}</span>
      </button>
      {node.type === 'directory' && expanded.includes(node.path) && render(node.children, level + 1)}
    </li>)}
  </ul>;
  return render(nodes);
}
