import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import workbookUrl from '../Striver A2Z DSA Sheet.xlsx?url';

const toArray = value => (Array.isArray(value) ? value : value ? [value] : []);
const textValue = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : value?.['#text'] || '');

export async function loadDsaRoadmap() {
  const response = await fetch(workbookUrl);
  if (!response.ok) throw new Error('Could not load the attached DSA workbook.');

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parseXml = path => {
    const bytes = files[path];
    if (!bytes) throw new Error(`Workbook is missing ${path}.`);
    return parser.parse(strFromU8(bytes));
  };

  const sharedStrings = toArray(parseXml('xl/sharedStrings.xml').sst.si).map(item => {
    if (item.t) return textValue(item.t);
    return toArray(item.r).map(run => textValue(run.t)).join('');
  });
  const workbook = parseXml('xl/workbook.xml').workbook;
  const relationships = toArray(parseXml('xl/_rels/workbook.xml.rels').Relationships.Relationship);
  const firstSheet = toArray(workbook.sheets.sheet)[0];
  if (!firstSheet) throw new Error('The DSA workbook has no worksheets.');

  const relationshipId = firstSheet['@_r:id'];
  const target = relationships.find(item => item['@_Id'] === relationshipId)?.['@_Target'];
  if (!target) throw new Error('Could not locate the DSA problems worksheet.');
  const worksheetPath = target.replace(/^\//, '').startsWith('xl/') ? target.replace(/^\//, '') : `xl/${target.replace(/^\//, '')}`;
  const rows = toArray(parseXml(worksheetPath).worksheet.sheetData.row);
  const steps = [];
  let currentStep;

  for (const row of rows) {
    const cells = toArray(row.c);
    const readColumn = column => {
      const cell = cells.find(entry => new RegExp(`^${column}\\d+$`).test(entry['@_r'] || ''));
      if (!cell) return '';
      const value = textValue(cell.v);
      return cell['@_t'] === 's' ? sharedStrings[Number(value)] || '' : value;
    };
    const number = readColumn('A');
    const title = String(readColumn('B')).trim();

    if (/^Step\s+\d+:/i.test(title)) {
      const match = title.match(/^Step\s+(\d+):\s*(.*)$/i);
      currentStep = { id: Number(match[1]), title: match[2], problems: [] };
      steps.push(currentStep);
    } else if (currentStep && number.trim() && Number.isInteger(Number(number)) && title) {
      currentStep.problems.push({ id: Number(number), title });
    }
  }

  const problemCount = steps.reduce((total, step) => total + step.problems.length, 0);
  if (problemCount !== 455 || steps.length === 0) {
    throw new Error(`Expected 455 numbered problems in the DSA workbook; found ${problemCount}.`);
  }

  return steps;
}
