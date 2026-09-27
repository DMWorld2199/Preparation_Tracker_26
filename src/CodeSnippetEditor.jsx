import React, { useEffect, useMemo, useState } from 'react';
import { indentWithTab } from '@codemirror/commands';
import { indentOnInput, indentUnit } from '@codemirror/language';
import CodeMirror from '@uiw/react-codemirror';
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { EditorView, keymap } from '@codemirror/view';
const editorTheme = EditorView.theme({
  '&': { backgroundColor: '#070a0f', color: '#e8edf5', height: '100%' },
  '.cm-content': { caretColor: '#ffffff', fontFamily: 'Consolas, "Courier New", monospace', minHeight: '240px', padding: '14px 0' },
  '.cm-gutters': { backgroundColor: '#070a0f', border: 'none', color: '#68778b' },
  '.cm-activeLine': { backgroundColor: '#ffffff0a' },
  '.cm-activeLineGutter': { backgroundColor: '#ffffff0a' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ffffff' },
  '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#24466b' },
}, { dark: true });

export default function CodeSnippetEditor({ snippet, onChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [languageSupport, setLanguageSupport] = useState(null);
  const current = snippet || { language: 'python', code: '' };
  useEffect(() => {
    let active = true;
    const loaders = {
      python: () => import('@codemirror/lang-python').then(module => module.python),
      cpp: () => import('@codemirror/lang-cpp').then(module => module.cpp),
      sql: () => import('@codemirror/lang-sql').then(module => module.sql),
    };
    loaders[current.language]().then(support => { if (active) setLanguageSupport(() => support); });
    return () => { active = false; };
  }, [current.language]);
  const extensions = useMemo(() => [
    ...(languageSupport ? [languageSupport()] : []),
    indentOnInput(),
    indentUnit.of('    '),
    keymap.of([indentWithTab]),
    EditorView.lineWrapping,
  ], [languageSupport]);
  const toolbar = isDialog => <div className="code-snippet-heading"><div className="code-snippet-title"><strong>Code snippet</strong><select aria-label="Code language" value={current.language} onChange={event => onChange({ ...current, language: event.target.value })}><option value="python">Python</option><option value="cpp">C++</option><option value="sql">SQL</option></select></div><div className="code-snippet-actions">{!isDialog && <button type="button" title={collapsed ? 'Expand code editor' : 'Collapse code editor'} aria-label={collapsed ? 'Expand code editor' : 'Collapse code editor'} aria-expanded={!collapsed} onClick={() => setCollapsed(previous => !previous)}><ChevronDown className={collapsed ? '' : 'code-chevron-open'} size={16} /></button>}<button type="button" title={isDialog ? 'Minimize code editor' : 'Maximize code editor'} aria-label={isDialog ? 'Minimize code editor' : 'Maximize code editor'} onClick={() => setMaximized(previous => !previous)}>{isDialog ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div></div>;
  const editor = <CodeMirror value={current.code} height={maximized ? '70vh' : '270px'} extensions={extensions} theme={editorTheme} basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, closeBrackets: true, highlightActiveLine: true, tabSize: 4 }} onChange={code => onChange({ ...current, code })} />;

  return <>
    <section className="code-snippet-panel">{toolbar(false)}{!collapsed && !maximized && editor}</section>
    {maximized && createPortal(<div className="code-snippet-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setMaximized(false); }}><section className="code-snippet-dialog" role="dialog" aria-modal="true" aria-label="Maximized code snippet">{toolbar(true)}{editor}</section></div>, document.body)}
  </>;
}