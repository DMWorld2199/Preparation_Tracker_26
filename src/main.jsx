import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Archive, Bold, Check, ChevronDown, Download, FileText, FolderOpen, Italic, List, ListOrdered, Maximize2, Menu, Minimize2, RotateCcw, Search, Trash2, Underline, Upload, X } from 'lucide-react';
import { roadmap } from './data';
import { loadDsaRoadmap } from './dsaData';
import './styles.css';

const CodeSnippetEditor = lazy(() => import('./CodeSnippetEditor'));

const CHECKS_KEY = 'aie_checks_react';
const NOTES_KEY = 'aie_notes_react';
const FILES_KEY = 'aie_files_react';
const DEADLINE_KEY = 'aie_deadline_react';
const NOTE_FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];
const NOTE_SIZES = ['12px', '14px', '16px', '18px', '24px', '32px'];
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const dsaDoneKey = problemId => `dsa:done:${problemId}`;
const dsaRevisitKey = problemId => `dsa:revisit:${problemId}`;
const isDsaDone = (checks, problemId) => !!(checks[dsaDoneKey(problemId)] || checks[`dsa:${problemId}`]);
const isDsaRevisit = (checks, problemId) => !!checks[dsaRevisitKey(problemId)];
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const sanitizeNoteHtml = value => {
  const isFormatted = /<\/?(p|div|br|ul|ol|li|strong|b|em|i|u|span|font)\b/i.test(value);
  const source = isFormatted ? value : escapeHtml(value).replace(/\r?\n/g, '<br>');
  const body = new DOMParser().parseFromString(source, 'text/html').body;
  const allowedTags = new Set(['p', 'div', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'span']);
  const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math']);
  const serialize = node => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (blockedTags.has(tag)) return '';
    const children = [...node.childNodes].map(serialize).join('');
    const fontFamily = NOTE_FONTS.find(font => font.toLowerCase() === (node.style.fontFamily || node.getAttribute('face') || '').replaceAll('"', '').toLowerCase());
    const fontSize = NOTE_SIZES.find(size => size === node.style.fontSize) || ({ 1: '12px', 2: '12px', 3: '14px', 4: '18px', 5: '24px', 6: '32px', 7: '32px' })[node.getAttribute('size')];
    if (tag === 'font') {
      const styles = [fontFamily && `font-family:${fontFamily}`, fontSize && `font-size:${fontSize}`].filter(Boolean).join(';');
      return styles ? `<span style="${styles}">${children}</span>` : children;
    }
    if (!allowedTags.has(tag)) return children;
    if (tag === 'br') return '<br>';
    const styles = tag === 'span' ? [fontFamily && `font-family:${fontFamily}`, fontSize && `font-size:${fontSize}`].filter(Boolean).join(';') : '';
    const styleAttribute = styles ? ` style="${styles}"` : '';
    return `<${tag}${styleAttribute}>${children}</${tag}>`;
  };
  return [...body.childNodes].map(serialize).join('');
};
const itemKey = (type, phase, index) => `${type}:${phase}:${index}`;
const aiDoneKey = item => `ai:done:${item}`;
const aiRevisitKey = item => `ai:revisit:${item}`;
const isAiDoneKey = (checks, item) => Object.prototype.hasOwnProperty.call(checks, aiDoneKey(item)) ? !!checks[aiDoneKey(item)] : !!checks[item];
const isAiRevisitKey = (checks, item) => !!checks[aiRevisitKey(item)];
const isAiDone = (checks, type, phase, index) => isAiDoneKey(checks, itemKey(type, phase, index));
const isAiRevisit = (checks, type, phase, index) => isAiRevisitKey(checks, itemKey(type, phase, index));
const topicKey = (phaseId, topicIndex) => `${phaseId}:${topicIndex}`;
const migrateNotes = notes => {
  const migrated = { ...notes };
  roadmap.forEach(phase => {
    if (Object.prototype.hasOwnProperty.call(migrated, phase.id)) {
      const firstTopicKey = topicKey(phase.id, 0);
      migrated[firstTopicKey] ||= migrated[phase.id];
      delete migrated[phase.id];
    }
  });
  return migrated;
};
const migrateFiles = files => files.map(file => file.topicKey ? file : { ...file, topicKey: topicKey(file.phase, 0) });
const progressKeys = phase => [
  ...phase.topics.flatMap((topic, index) => [
    itemKey('t', phase.id, index),
    ...topic.subtopics.map((_, subIndex) => itemKey('s', phase.id, `${index}:${subIndex}`)),
  ]),
  ...phase.projects.map((_, index) => itemKey('p', phase.id, index)),
];

function App() {
  const [page, setPage] = useState('ai');
  const [dsaRoadmap, setDsaRoadmap] = useState(null);
  const [dsaLoadError, setDsaLoadError] = useState('');
  const [checks, setChecks] = useState(() => read(CHECKS_KEY, {}));
  const [notes, setNotes] = useState(() => migrateNotes(read(NOTES_KEY, {})));
  const [codeSnippets, setCodeSnippets] = useState(() => read('aie_code_snippets_react', {}));
  const [files, setFiles] = useState(() => migrateFiles(read(FILES_KEY, [])));
  const [deadline, setDeadline] = useState(() => localStorage.getItem(DEADLINE_KEY) || '');
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [selectedPhase, setSelectedPhase] = useState(1);
  const [selectedTopic, setSelectedTopic] = useState({ phaseId: 1, topicIndex: 0 });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState('');
  const [showReset, setShowReset] = useState(false);

  useEffect(() => save(CHECKS_KEY, checks), [checks]);
  useEffect(() => save(NOTES_KEY, notes), [notes]);
  useEffect(() => save('aie_code_snippets_react', codeSnippets), [codeSnippets]);
  useEffect(() => save(FILES_KEY, files), [files]);
  useEffect(() => { if (deadline) localStorage.setItem(DEADLINE_KEY, deadline); else localStorage.removeItem(DEADLINE_KEY); }, [deadline]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 1800); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    if (page !== 'dsa' || dsaRoadmap || dsaLoadError) return;
    loadDsaRoadmap().then(setDsaRoadmap).catch(error => setDsaLoadError(error.message || 'Could not load the DSA workbook.'));
  }, [page, dsaRoadmap, dsaLoadError]);

  const daysPending = deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - clock) / 86400000)) : null;

  const totals = useMemo(() => {
    const total = roadmap.reduce((sum, phase) => sum + progressKeys(phase).length, 0);
    const done = roadmap.reduce((sum, phase) => sum + progressKeys(phase).filter(key => isAiDoneKey(checks, key)).length, 0);
    const started = roadmap.filter(phase => progressKeys(phase).some(key => isAiDoneKey(checks, key) || isAiRevisitKey(checks, key))).length;
    return { total, done, started, percent: total ? Math.round((done / total) * 100) : 0 };
  }, [checks]);

  const matches = (text, phaseId, type, index) => {
    const done = isAiDone(checks, type, phaseId, index);
    const revisit = isAiRevisit(checks, type, phaseId, index);
    return (!query || text.toLowerCase().includes(query.toLowerCase()) || roadmap[phaseId]?.title.toLowerCase().includes(query.toLowerCase())) && (status === 'all' || (status === 'done' && done) || (status === 'revisit' && revisit) || (status === 'todo' && !done && !revisit));
  };

  const toggle = (statusType, type, phaseId, index) => setChecks(previous => {
    const item = itemKey(type, phaseId, index);
    const key = statusType === 'done' ? aiDoneKey(item) : aiRevisitKey(item);
    const current = statusType === 'done' ? isAiDoneKey(previous, item) : isAiRevisitKey(previous, item);
    return { ...previous, [key]: !current };
  });
  const reset = () => { setChecks({}); setNotes({}); setCodeSnippets({}); setFiles([]); setShowReset(false); setToast('Everything reset'); };
  const exportBackup = () => { const blob = new Blob([JSON.stringify({ version: 2, created: new Date().toISOString(), checks, notes, codeSnippets, files, deadline })], { type: 'application/json' }); downloadBlob(blob, 'ai-engineer-roadmap-backup.json'); setToast('Backup exported'); };
  const importBackup = event => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); setChecks(data.checks || {}); setNotes(migrateNotes(data.notes || {})); setCodeSnippets(data.codeSnippets || {}); setFiles(migrateFiles(data.files || [])); setDeadline(data.deadline || ''); setToast('Backup restored'); } catch { setToast('That backup is not valid JSON'); } }; reader.readAsText(file); event.target.value = ''; };
  const addFiles = event => { const incoming = [...(event.target.files || event.dataTransfer?.files || [])]; const selectedTopicKey = topicKey(selectedTopic.phaseId, selectedTopic.topicIndex); incoming.forEach(file => { const reader = new FileReader(); reader.onload = () => setFiles(previous => [...previous, { id: crypto.randomUUID(), phase: selectedTopic.phaseId, topicKey: selectedTopicKey, name: file.name, size: file.size, type: file.type, data: reader.result }]); reader.readAsDataURL(file); }); event.target.value = ''; setToast('Notes attached to this topic'); };
  const visiblePhases = roadmap.filter(phase => phaseFilter === 'all' || String(phase.id) === phaseFilter).map(phase => ({ ...phase, visibleTopics: phase.topics.filter((topic, index) => matches(topic.title, phase.id, 't', index) || topic.subtopics.some(subtopic => query && subtopic.toLowerCase().includes(query.toLowerCase()))), visibleProjects: phase.projects.filter((project, index) => matches(project, phase.id, 'p', index)) })).filter(phase => !query || phase.visibleTopics.length || phase.visibleProjects.length || phaseFilter !== 'all');
  const activePhase = roadmap.find(phase => phase.id === selectedTopic.phaseId) || roadmap[0];
  const activeTopic = activePhase.topics[selectedTopic.topicIndex] || activePhase.topics[0];
  const activeTopicKey = topicKey(activePhase.id, activePhase.topics.indexOf(activeTopic));

  if (page === 'dsa') {
    if (dsaLoadError) return <div className="app-shell"><TrackSelector page={page} setPage={setPage} /><main className="dsa-loading"><h1>Could not load the DSA tracker</h1><p>{dsaLoadError}</p><button className="button secondary" onClick={() => { setDsaLoadError(''); setDsaRoadmap(null); }}>Retry</button></main></div>;
    if (!dsaRoadmap) return <div className="app-shell"><TrackSelector page={page} setPage={setPage} /><main className="dsa-loading"><h1>Loading Striver A2Z DSA Sheet</h1><p>Reading the workbook and preparing its 455 problem checks.</p></main></div>;
    return <DsaTracker roadmap={dsaRoadmap} page={page} setPage={setPage} />;
  }

  return <div className="app-shell">
    <TrackSelector page={page} setPage={setPage} portalTarget=".topbar-inner" />
    <header className="topbar"><div className="topbar-inner"><div className="brand"><div className="brand-mark">AI</div><div><p className="eyebrow">FIELD GUIDE / 2026</p><h1>AI Engineer Roadmap</h1></div></div><div className="top-actions"><div className="deadline-picker-wrap"><button className="deadline-day-button" type="button" title={deadline ? `${daysPending} days pending. Click to change deadline` : 'Set deadline'} aria-label={deadline ? `${daysPending} days pending; change deadline` : 'Set deadline'} aria-expanded={showDeadlinePicker} onClick={() => { setDeadlineDraft(deadline); setShowDeadlinePicker(previous => !previous); }}><span className="deadline-days">{daysPending === null ? '--' : daysPending}</span><span className="deadline-label">DAYS LEFT !!!</span></button>{showDeadlinePicker && <div className="deadline-popover"><div className="deadline-popover-heading"><strong>Set deadline</strong><button type="button" className="deadline-close" aria-label="Close deadline picker" onClick={() => setShowDeadlinePicker(false)}><X size={15} /></button></div><input type="datetime-local" value={deadlineDraft} onChange={event => setDeadlineDraft(event.target.value)} aria-label="Choose deadline date and time" /><div className="deadline-popover-actions"><button type="button" className="button secondary" onClick={() => { setDeadline(''); setDeadlineDraft(''); setShowDeadlinePicker(false); }}>Clear</button><button type="button" className="button" disabled={!deadlineDraft} onClick={() => { setDeadline(deadlineDraft); setShowDeadlinePicker(false); }}>Save</button></div></div>}</div><button className="button secondary" onClick={() => { setExpanded(!expanded); setSelectedPhase(expanded ? 1 : -1); }}><Menu size={16} /> {expanded ? 'Collapse all' : 'Expand all'}</button><button className="button secondary" onClick={exportBackup}><Archive size={16} /> Export</button><label className="button secondary"><FolderOpen size={16} /> Import<input type="file" accept=".json" hidden onChange={importBackup} /></label></div></div></header>
    <main className="container">
      <section className="hero-grid"><div className="hero-panel"><span className="kicker">26 WEEKS / LOCAL-FIRST</span><h2>Build the stack.<br /><em>Ship the system.</em></h2><p>Track the complete Ultimate AI Engineer Roadmap 2026, from Python foundations to a production multi-LLM platform.</p><div className="progress-line"><div className="progress-track"><span style={{ width: `${totals.percent}%` }} /></div><strong>{totals.percent}%</strong></div><div className="milestones"><span>FOUNDATION</span><span>INTELLIGENCE</span><span>PRODUCTION</span></div></div><div className="stats-panel"><Stat value={totals.done} label="items complete" /><Stat value={totals.total} label="trackable items" /><Stat value={totals.started} label="phases started" /><Stat value={files.length} label="notes attached" /></div></section>
      <section className="toolbar"><div className="search-wrap"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the roadmap" /></div><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All status</option><option value="todo">To do</option><option value="revisit">Revisit</option><option value="done">Done</option></select><select value={phaseFilter} onChange={event => setPhaseFilter(event.target.value)}><option value="all">All phases</option>{roadmap.map(phase => <option key={phase.id} value={phase.id}>Phase {phase.id} · {phase.title}</option>)}</select><button className="button danger" onClick={() => setShowReset(true)}><RotateCcw size={16} /> Reset</button></section>
      <section className="content-grid"><div className="roadmap-list">{visiblePhases.map(phase => <PhaseCard key={phase.id} phase={phase} checks={checks} expanded={expanded || selectedPhase === phase.id || !!query} selectedTopicKey={activeTopicKey} onSelectTopic={(phaseId, topicIndex) => setSelectedTopic({ phaseId, topicIndex })} onOpen={() => setSelectedPhase(phase.id)} toggle={toggle} />)}{!visiblePhases.length && <div className="empty">No roadmap items match that search.</div>}</div><aside><NotesPanel phase={activePhase} topic={activeTopic} topicKey={activeTopicKey} notes={notes} setNotes={setNotes} codeSnippets={codeSnippets} setCodeSnippets={setCodeSnippets} /><FilesPanel topicKey={activeTopicKey} files={files} addFiles={addFiles} setFiles={setFiles} /></aside></section>
    </main>
    {showReset && <div className="modal-backdrop"><div className="modal"><button className="close" onClick={() => setShowReset(false)}><X size={18} /></button><span className="kicker">RESET WORKSPACE</span><h3>Start the tracker over?</h3><p>This clears progress, notes, and attached files from this browser.</p><div className="modal-actions"><button className="button secondary" onClick={() => setShowReset(false)}>Cancel</button><button className="button danger" onClick={reset}>Reset everything</button></div></div></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

function TrackSelector({ page, setPage, portalTarget }) {
  const [container, setContainer] = useState(null);
  useEffect(() => {
    if (portalTarget) setContainer(document.querySelector(portalTarget));
  }, [portalTarget]);
  const selector = <nav className="track-switch"><label htmlFor="track-select">TRACK</label><select id="track-select" value={page} onChange={event => setPage(event.target.value)}><option value="ai">AI Engineer Roadmap</option><option value="dsa">Striver A2Z DSA Sheet</option></select></nav>;
  return portalTarget ? (container ? createPortal(selector, container) : null) : selector;
}

function DsaTracker({ roadmap: steps, page, setPage }) {
  const [checks, setChecks] = useState(() => read('aie_dsa_checks_v1', {}));
  const [notes, setNotes] = useState(() => read('aie_dsa_notes_v1', {}));
  const [codeSnippets, setCodeSnippets] = useState(() => read('aie_dsa_code_snippets_v1', {}));
  const [files, setFiles] = useState(() => read('aie_dsa_files_v1', []));
  const [deadline, setDeadline] = useState(() => localStorage.getItem('aie_dsa_deadline_v1') || '');
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [stepFilter, setStepFilter] = useState('all');
  const [selectedProblemId, setSelectedProblemId] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({ 1: true });
  const [showReset, setShowReset] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => save('aie_dsa_checks_v1', checks), [checks]);
  useEffect(() => save('aie_dsa_notes_v1', notes), [notes]);
  useEffect(() => save('aie_dsa_code_snippets_v1', codeSnippets), [codeSnippets]);
  useEffect(() => save('aie_dsa_files_v1', files), [files]);
  useEffect(() => { if (deadline) localStorage.setItem('aie_dsa_deadline_v1', deadline); else localStorage.removeItem('aie_dsa_deadline_v1'); }, [deadline]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 1800); return () => clearTimeout(timer); } }, [toast]);

  const daysPending = deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - clock) / 86400000)) : null;
  const total = steps.reduce((sum, step) => sum + step.problems.length, 0);
  const done = steps.reduce((sum, step) => sum + step.problems.filter(problem => isDsaDone(checks, problem.id)).length, 0);
  const started = steps.filter(step => step.problems.some(problem => isDsaDone(checks, problem.id) || isDsaRevisit(checks, problem.id))).length;
  const activeStep = steps.find(step => step.problems.some(problem => problem.id === selectedProblemId)) || steps[0];
  const activeProblem = activeStep.problems.find(problem => problem.id === selectedProblemId) || activeStep.problems[0];
  const activeProblemKey = `dsa:${activeProblem.id}`;
  const visibleSteps = steps
    .filter(step => stepFilter === 'all' || String(step.id) === stepFilter)
    .map(step => ({ ...step, visibleProblems: step.problems.filter(problem => {
      const completed = isDsaDone(checks, problem.id);
      const revisit = isDsaRevisit(checks, problem.id);
      return (!search || problem.title.toLowerCase().includes(search.toLowerCase()) || step.title.toLowerCase().includes(search.toLowerCase())) && (status === 'all' || (status === 'done' && completed) || (status === 'revisit' && revisit) || (status === 'todo' && !completed && !revisit));
    }) }))
    .filter(step => !search || step.visibleProblems.length || stepFilter !== 'all');

  const toggleProblem = (type, problemId) => setChecks(previous => {
    const key = type === 'done' ? dsaDoneKey(problemId) : dsaRevisitKey(problemId);
    return { ...previous, [key]: !previous[key] };
  });
  const reset = () => { setChecks({}); setNotes({}); setCodeSnippets({}); setFiles([]); setShowReset(false); setToast('DSA progress reset'); };
  const exportBackup = () => {
    const backup = { type: 'striver-a2z-dsa-v1', created: new Date().toISOString(), checks, notes, codeSnippets, files, deadline };
    downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), 'striver-a2z-dsa-backup.json');
    setToast('DSA backup exported');
  };
  const importBackup = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result);
        if (backup.type !== 'striver-a2z-dsa-v1') throw new Error('Choose a Striver DSA backup file.');
        setChecks(backup.checks || {});
        setNotes(backup.notes || {});
        setCodeSnippets(backup.codeSnippets || {});
        setFiles(backup.files || []);
        setDeadline(backup.deadline || '');
        setToast('DSA backup restored');
      } catch (error) { setToast(error.message || 'That backup is not valid JSON'); }
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  const addFiles = event => {
    const incoming = [...(event.target.files || event.dataTransfer?.files || [])];
    incoming.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => setFiles(previous => [...previous, { id: crypto.randomUUID(), phase: activeStep.id, topicKey: activeProblemKey, name: file.name, size: file.size, type: file.type, data: reader.result }]);
      reader.readAsDataURL(file);
    });
    event.target.value = '';
    setToast('Files attached to this problem');
  };

  return <div className="app-shell dsa-shell">
    <header className="topbar dsa-topbar"><div className="dsa-header-inner"><div className="brand"><div className="brand-mark">DS</div><div><p className="eyebrow">PROBLEM SOLVING / 455 QUESTIONS</p><h1>Striver A2Z DSA Tracker</h1></div></div><TrackSelector page={page} setPage={setPage} /><div className="dsa-header-actions"><div className="deadline-picker-wrap"><button className="deadline-day-button" type="button" title={deadline ? `${daysPending} days pending. Click to change deadline` : 'Set deadline'} aria-label={deadline ? `${daysPending} days pending; change deadline` : 'Set deadline'} aria-expanded={showDeadlinePicker} onClick={() => { setDeadlineDraft(deadline); setShowDeadlinePicker(previous => !previous); }}><span className="deadline-days">{daysPending === null ? '--' : daysPending}</span><span className="deadline-label">DAYS LEFT !!!</span></button>{showDeadlinePicker && <div className="deadline-popover"><div className="deadline-popover-heading"><strong>Set deadline</strong><button type="button" className="deadline-close" aria-label="Close deadline picker" onClick={() => setShowDeadlinePicker(false)}><X size={15} /></button></div><input type="datetime-local" value={deadlineDraft} onChange={event => setDeadlineDraft(event.target.value)} aria-label="Choose deadline date and time" /><div className="deadline-popover-actions"><button type="button" className="button secondary" onClick={() => { setDeadline(''); setDeadlineDraft(''); setShowDeadlinePicker(false); }}>Clear</button><button type="button" className="button" disabled={!deadlineDraft} onClick={() => { setDeadline(deadlineDraft); setShowDeadlinePicker(false); }}>Save</button></div></div>}</div><button className="button secondary" onClick={() => setExpandedSteps(Object.fromEntries(steps.map(step => [step.id, true])))}><Menu size={16} /> Expand steps</button><button className="button secondary" onClick={exportBackup}><Archive size={16} /> Export</button><label className="button secondary"><FolderOpen size={16} /> Import<input type="file" accept=".json" hidden onChange={importBackup} /></label></div></div></header>
    <main className="dsa-container">
      <section className="dsa-hero"><div className="dsa-hero-copy"><span className="kicker">STRIVER'S A2Z SHEET / LOCAL-FIRST</span><h2>Build the habit.<br /><em>Solve the set.</em></h2><p>Track every problem from fundamentals through advanced data structures. Your checks, notes, and attachments stay saved on this device.</p><div className="dsa-progress-line"><div className="progress-track" role="progressbar" aria-label="DSA problems completed" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${total ? Math.round(done / total * 100) : 0}%` }} /></div><strong>{total ? Math.round(done / total * 100) : 0}%</strong></div></div><div className="dsa-stats"><div><strong>{done}<small>/{total}</small></strong><span>problems solved</span></div><div><strong>{started}<small>/{steps.length}</small></strong><span>steps started</span></div><div><strong>{files.length}</strong><span>attachments</span></div></div></section>
      <section className="dsa-toolbar"><div className="search-wrap"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search DSA problems" /></div><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All status</option><option value="todo">To do</option><option value="revisit">Revisit</option><option value="done">Done</option></select><select value={stepFilter} onChange={event => setStepFilter(event.target.value)}><option value="all">All steps</option>{steps.map(step => <option key={step.id} value={step.id}>Step {step.id}: {step.title}</option>)}</select><button className="button danger" onClick={() => setShowReset(true)}><RotateCcw size={16} /> Reset</button></section>
      <section className="dsa-content-grid"><div className="dsa-step-list">{visibleSteps.map(step => <DsaStepCard key={step.id} step={step} checks={checks} expanded={!!search || stepFilter === String(step.id) || !!expandedSteps[step.id]} selectedProblemId={selectedProblemId ?? steps[0].problems[0].id} onSelectProblem={problemId => setSelectedProblemId(problemId)} toggleProblem={toggleProblem} onToggleStep={() => setExpandedSteps(previous => ({ ...previous, [step.id]: !previous[step.id] }))} />)}{!visibleSteps.length && <div className="empty">No DSA problems match those filters.</div>}</div><aside><NotesPanel phase={activeStep} topic={activeProblem} topicKey={activeProblemKey} notes={notes} setNotes={setNotes} codeSnippets={codeSnippets} setCodeSnippets={setCodeSnippets} /><FilesPanel topicKey={activeProblemKey} files={files} addFiles={addFiles} setFiles={setFiles} /></aside></section>
    </main>
    {showReset && <div className="modal-backdrop"><div className="modal"><button className="close" onClick={() => setShowReset(false)}><X size={18} /></button><span className="kicker">RESET DSA TRACKER</span><h3>Clear DSA progress?</h3><p>This clears DSA checks, notes, and attachments from this browser. Your AI roadmap stays unchanged.</p><div className="modal-actions"><button className="button secondary" onClick={() => setShowReset(false)}>Cancel</button><button className="button danger" onClick={reset}>Reset DSA tracker</button></div></div></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

function DsaStepCard({ step, checks, expanded, selectedProblemId, onSelectProblem, toggleProblem, onToggleStep }) {
  const problems = step.visibleProblems || step.problems;
  const done = step.problems.filter(problem => isDsaDone(checks, problem.id)).length;
  const percent = Math.round((done / step.problems.length) * 100);
  return <article className={`dsa-step-card ${expanded ? 'is-open' : ''}`}><button className="dsa-step-heading" aria-expanded={expanded} onClick={onToggleStep}><span className="dsa-step-number">{String(step.id).padStart(2, '0')}</span><span className="dsa-step-copy"><strong>{step.title}</strong><span>{done}/{step.problems.length} problems</span><span className="dsa-step-progress"><span style={{ width: `${percent}%` }} /></span></span><span className="dsa-step-percent">{percent}%</span><ChevronDown className={`dsa-step-chevron ${expanded ? 'rotated' : ''}`} size={18} /></button>{expanded && <div className="dsa-problem-list">{problems.map(problem => {
    const doneChecked = isDsaDone(checks, problem.id);
    const revisitChecked = isDsaRevisit(checks, problem.id);
    return <div key={problem.id} className={`dsa-problem-row ${doneChecked ? 'done-checked' : ''} ${revisitChecked ? 'revisit-checked' : ''} ${selectedProblemId === problem.id ? 'selected' : ''}`}><button className="dsa-problem-title" onClick={() => onSelectProblem(problem.id)}><span className="dsa-problem-number">{String(problem.id).padStart(3, '0')}</span><span>{problem.title}</span></button><div className="dsa-problem-statuses"><label className="dsa-problem-status done"><input type="checkbox" checked={doneChecked} onChange={() => toggleProblem('done', problem.id)} /><span className="status-checkmark">{doneChecked && <Check size={12} />}</span><span>Done</span></label><label className="dsa-problem-status revisit"><input type="checkbox" checked={revisitChecked} onChange={() => toggleProblem('revisit', problem.id)} /><span className="status-checkmark">{revisitChecked && <Check size={12} />}</span><span>Revisit</span></label></div></div>;
  })}</div>}</article>;
}

function Stat({ value, label }) { return <div className="stat"><strong>{value}</strong><span>{label}</span></div>; }
function PhaseCard({ phase, checks, expanded, selectedTopicKey, onSelectTopic, onOpen, toggle }) {
  const keys = progressKeys(phase);
  const done = keys.filter(key => isAiDoneKey(checks, key)).length;
  const total = keys.length;
  return <article className={`phase-card ${expanded ? 'is-open' : ''}`}><button className="phase-heading" onClick={onOpen}><span className="phase-number">{String(phase.id).padStart(2, '0')}</span><span className="phase-copy"><strong>{phase.title}</strong><small>{phase.goal}</small></span><span className="phase-count">{done}/{total}<small>{Math.round(done / total * 100)}%</small></span><ChevronDown className="chevron" size={19} /></button>{expanded && <div className="phase-body"><TopicGroup label="TOPICS" items={phase.visibleTopics || phase.topics} phase={phase} type="t" checks={checks} toggle={toggle} selectedTopicKey={selectedTopicKey} onSelectTopic={onSelectTopic} /><TopicGroup label="PROJECTS" items={phase.visibleProjects || phase.projects} phase={phase} type="p" checks={checks} toggle={toggle} /></div>}</article>;
}
function TopicGroup({ label, items, phase, type, checks, toggle, selectedTopicKey, onSelectTopic }) {
  const [expandedTopics, setExpandedTopics] = useState({});
  return <div className="topic-group"><div className="group-label">{label}</div>{items.map(item => {
    if (type === 'p') {
      const index = phase.projects.indexOf(item);
      const checked = isAiDone(checks, 'p', phase.id, index);
      const revisit = isAiRevisit(checks, 'p', phase.id, index);
      return <div className={`topic-row ${checked ? 'checked' : ''} ${revisit ? 'revisited' : ''}`} key={item}><span className="project-title"><span className="project-name">{item}</span><b className="project-tag">BUILD</b></span><ItemStatusControls checks={checks} type="p" phaseId={phase.id} index={index} toggle={toggle} /></div>;
    }
    const index = phase.topics.indexOf(item);
    const checked = isAiDone(checks, 't', phase.id, index);
    const revisit = isAiRevisit(checks, 't', phase.id, index);
    const isExpanded = !!expandedTopics[index];
    const completedSubtopics = item.subtopics.filter((_, subIndex) => isAiDone(checks, 's', phase.id, `${index}:${subIndex}`)).length;
    const topicPercent = Math.round((completedSubtopics / item.subtopics.length) * 100);
    return <div className="topic-entry" key={item.title}>
      <div className={`topic-row ${checked ? 'checked' : ''} ${revisit ? 'revisited' : ''} ${selectedTopicKey === topicKey(phase.id, index) ? 'selected-topic' : ''}`}>
        <button className="topic-heading" aria-expanded={isExpanded} onClick={() => { onSelectTopic(phase.id, index); setExpandedTopics(previous => ({ ...previous, [index]: !previous[index] })); }}><span className="topic-heading-copy"><span>{item.title}</span><span className="topic-progress-meta">{completedSubtopics}/{item.subtopics.length} subtopics complete</span><span className="topic-progress-track" role="progressbar" aria-label={`${item.title} subtopic progress`} aria-valuemin="0" aria-valuemax={item.subtopics.length} aria-valuenow={completedSubtopics}><span style={{ width: `${topicPercent}%` }} /></span></span><ChevronDown size={15} className={`topic-chevron ${isExpanded ? 'rotated' : ''}`} /></button>
        <ItemStatusControls checks={checks} type="t" phaseId={phase.id} index={index} toggle={toggle} />
      </div>
      {isExpanded && <div className="subtopic-list">{item.subtopics.map((subtopic, subIndex) => {
        const subIndexKey = `${index}:${subIndex}`;
        const subChecked = isAiDone(checks, 's', phase.id, subIndexKey);
        const subRevisit = isAiRevisit(checks, 's', phase.id, subIndexKey);
        return <div className={`subtopic-row ${subChecked ? 'checked' : ''} ${subRevisit ? 'revisited' : ''}`} key={subtopic}><span className="subtopic-title">{subtopic}</span><ItemStatusControls checks={checks} type="s" phaseId={phase.id} index={subIndexKey} toggle={toggle} compact /></div>;
      })}</div>}
    </div>;
  })}</div>;
}
function ItemStatusControls({ checks, type, phaseId, index, toggle, compact = false }) {
  const done = isAiDone(checks, type, phaseId, index);
  const revisit = isAiRevisit(checks, type, phaseId, index);
  return <div className={`tracker-statuses ${compact ? 'compact' : ''}`}><label className="tracker-status done"><input type="checkbox" checked={done} onChange={() => toggle('done', type, phaseId, index)} /><span className="status-checkmark">{done && <Check size={12} />}</span><span>Done</span></label><label className="tracker-status revisit"><input type="checkbox" checked={revisit} onChange={() => toggle('revisit', type, phaseId, index)} /><span className="status-checkmark">{revisit && <Check size={12} />}</span><span>Revisit</span></label></div>;
}
function NotesPanel({ phase, topic, topicKey: selectedTopicKey, notes, setNotes, codeSnippets, setCodeSnippets }) {
  const editorRef = useRef(null);
  const selectionRef = useRef(null);
  const [font, setFont] = useState('');
  const [size, setSize] = useState('');
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [notesMaximized, setNotesMaximized] = useState(false);

  useLayoutEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = sanitizeNoteHtml(notes[selectedTopicKey] || '');
    selectionRef.current = null;
    setNotesCollapsed(false);
    setNotesMaximized(false);
  }, [selectedTopicKey]);

  const saveNote = () => {
    if (!editorRef.current) return;
    const value = sanitizeNoteHtml(editorRef.current.innerHTML);
    setNotes(previous => ({ ...previous, [selectedTopicKey]: value }));
  };
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return null;
    editor.focus();
    if (selectionRef.current && editor.contains(selectionRef.current.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(selectionRef.current);
    }
    return selection.rangeCount ? selection.getRangeAt(0) : null;
  };
  const runCommand = command => {
    restoreSelection();
    document.execCommand(command, false);
    rememberSelection();
    saveNote();
  };
  const applyInlineStyle = (property, value) => {
    const range = restoreSelection();
    if (!range) return;
    const selection = window.getSelection();
    if (range.collapsed) {
      if (property === 'fontFamily') document.execCommand('fontName', false, value);
      else document.execCommand('fontSize', false, ({ '12px': '2', '14px': '3', '16px': '3', '18px': '4', '24px': '5', '32px': '6' })[value]);
    } else {
      const fragment = range.cloneContents();
      if (fragment.querySelector('p, div, ul, ol, li')) {
        if (property === 'fontFamily') document.execCommand('fontName', false, value);
        else document.execCommand('fontSize', false, ({ '12px': '2', '14px': '3', '16px': '3', '18px': '4', '24px': '5', '32px': '6' })[value]);
      } else {
        const wrapper = document.createElement('span');
        wrapper.style[property] = value;
        wrapper.append(range.extractContents());
        range.insertNode(wrapper);
        range.selectNodeContents(wrapper);
        selection?.removeAllRanges();
        selection?.addRange(range);
        selectionRef.current = range.cloneRange();
      }
    }
    rememberSelection();
    saveNote();
  };
  const insertPlainText = event => {
    event.preventDefault();
    restoreSelection();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    saveNote();
  };
  const snippet = codeSnippets[selectedTopicKey] || { language: 'python', code: '' };
  const updateSnippet = value => setCodeSnippets(previous => ({ ...previous, [selectedTopicKey]: value }));

  return <>
    {notesMaximized && createPortal(<div className="notes-maximize-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNotesMaximized(false); }} />, document.body)}
    <section className={`side-panel ${notesMaximized ? 'notes-maximized' : ''}`}>
    <div className="panel-heading"><div><span className="kicker">TOPIC WORKBENCH / P{phase.id}</span><h3>My Notes</h3></div><div className="notes-panel-actions"><span className="phase-pill">P{phase.id}</span><button type="button" title={notesCollapsed ? 'Expand notes' : 'Collapse notes'} aria-label={notesCollapsed ? 'Expand notes' : 'Collapse notes'} aria-expanded={!notesCollapsed} onClick={() => setNotesCollapsed(previous => !previous)}><ChevronDown className={notesCollapsed ? '' : 'notes-chevron-open'} size={16} /></button><button type="button" title={notesMaximized ? 'Minimize notes' : 'Maximize notes'} aria-label={notesMaximized ? 'Minimize notes' : 'Maximize notes'} onClick={() => setNotesMaximized(previous => !previous)}>{notesMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div></div>
    <p className="selected-topic-label">{topic.title}</p>
    <div className="note-toolbar" role="toolbar" aria-label="Note formatting">
      <select aria-label="Font family" value={font} onMouseDown={rememberSelection} onChange={event => { applyInlineStyle('fontFamily', event.target.value); setFont(''); }}><option value="">Font</option>{NOTE_FONTS.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <select aria-label="Font size" value={size} onMouseDown={rememberSelection} onChange={event => { applyInlineStyle('fontSize', event.target.value); setSize(''); }}><option value="">Size</option>{NOTE_SIZES.map(value => <option key={value} value={value}>{value}</option>)}</select>
      <button type="button" title="Bold" aria-label="Bold" onMouseDown={event => event.preventDefault()} onClick={() => runCommand('bold')}><Bold size={15} /></button>
      <button type="button" title="Italic" aria-label="Italic" onMouseDown={event => event.preventDefault()} onClick={() => runCommand('italic')}><Italic size={15} /></button>
      <button type="button" title="Underline" aria-label="Underline" onMouseDown={event => event.preventDefault()} onClick={() => runCommand('underline')}><Underline size={15} /></button>
      <span className="note-toolbar-divider" />
      <button type="button" title="Bulleted list" aria-label="Bulleted list" onMouseDown={event => event.preventDefault()} onClick={() => runCommand('insertUnorderedList')}><List size={16} /></button>
      <button type="button" title="Numbered list" aria-label="Numbered list" onMouseDown={event => event.preventDefault()} onClick={() => runCommand('insertOrderedList')}><ListOrdered size={16} /></button>
    </div>
    {!notesCollapsed && <><div ref={editorRef} className="note-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={`Notes for ${topic.title}`} data-placeholder={`Capture your takeaways from ${topic.title}...`} onInput={saveNote} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onPaste={insertPlainText} /><small className="muted">Autosaved for this topic in this browser.</small></>}
    {!notesMaximized && <Suspense fallback={<small className="muted">Loading code editor...</small>}><CodeSnippetEditor key={selectedTopicKey} snippet={snippet} onChange={updateSnippet} /></Suspense>}
    </section>
  </>;
}
function FilesPanel({ topicKey: selectedTopicKey, files, addFiles, setFiles }) { const topicFiles = files.filter(file => file.topicKey === selectedTopicKey); return <section className="side-panel"><div className="panel-heading"><div><span className="kicker">TOPIC MATERIAL</span><h3>Attachments</h3></div><Upload size={18} /></div><label className="dropzone"><Upload size={21} /><strong>Drop files or browse</strong><small>PDF, images, Markdown, text</small><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.md,.doc,.docx" hidden onChange={addFiles} /></label><div className="file-list">{topicFiles.map(file => <div className="file-row" key={file.id}><FileText size={16} /><span title={file.name}>{file.name}</span><button onClick={() => downloadDataUrl(file.data, file.name)} title="Download"><Download size={15} /></button><button onClick={() => setFiles(previous => previous.filter(item => item.id !== file.id))} title="Delete"><Trash2 size={15} /></button></div>)}{!topicFiles.length && <small className="muted">No files attached to this topic.</small>}</div></section>; }
function downloadBlob(blob, name) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function downloadDataUrl(data, name) { const link = document.createElement('a'); link.href = data; link.download = name; link.click(); }

createRoot(document.getElementById('root')).render(<App />);
