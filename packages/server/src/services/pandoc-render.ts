import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = 30_000;

async function renderMarkdownToOffice(
  markdown: string,
  format: 'docx' | 'pptx',
  referenceDocPath?: string,
): Promise<Buffer> {
  let effectiveRef = referenceDocPath;
  if (effectiveRef && !existsSync(effectiveRef)) {
    console.warn(`[pandoc] Reference doc not found, exporting without style: ${effectiveRef}`);
    effectiveRef = undefined;
  }

  const id = randomUUID();
  const mdPath = join(tmpdir(), `fragmint-plan-${id}.md`);
  const outPath = join(tmpdir(), `fragmint-plan-${id}.${format}`);
  writeFileSync(mdPath, markdown, 'utf-8');

  const args = ['-f', 'markdown', '-t', format, '-o', outPath];
  if (format === 'docx') args.push('--columns=200');
  if (effectiveRef) args.push(`--reference-doc=${effectiveRef}`);
  args.push(mdPath);

  try {
    await runPandoc(args);
    if (format === 'docx' && effectiveRef) {
      await patchDocxTableStyle(outPath, 'TableGridLinagora');
    }
    return readFileSync(outPath);
  } finally {
    for (const f of [mdPath, outPath]) {
      if (existsSync(f)) try { unlinkSync(f); } catch (_) {}
    }
  }
}

export function renderMarkdownToDocx(markdown: string, referenceDocPath?: string): Promise<Buffer> {
  return renderMarkdownToOffice(markdown, 'docx', referenceDocPath);
}

export function renderMarkdownToPptx(markdown: string, referenceDocPath?: string): Promise<Buffer> {
  return renderMarkdownToOffice(markdown, 'pptx', referenceDocPath);
}

// Patch the generated DOCX:
// 1. Replace Pandoc's hardcoded tblStyle "Table" with the Linagora table style.
// 2. Inject the Compact paragraph style into styles.xml — Pandoc references it in table cells
//    but does not copy its definition from the reference doc.
const COMPACT_STYLE_XML = `<w:style xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr></w:style>`;

function patchDocxTableStyle(docxPath: string, targetStyleId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = [
      'import zipfile, os, sys',
      'import xml.etree.ElementTree as ET',
      'src = sys.argv[1]',
      'style = sys.argv[2]',
      'compact_xml = sys.argv[3].encode("utf-8")',
      'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
      'def patch_doc(data):',
      '    data = data.replace(b\'<w:tblStyle w:val="Table"\', b\'<w:tblStyle w:val="\' + style.encode() + b\'"\')',
      '    # Inject numId=0 on every paragraph inside table cells so LibreOffice cannot',
      '    # apply the template outline numbering to table content.',
      '    ET.register_namespace("w", W)',
      '    root = ET.fromstring(data.decode("utf-8"))',
      '    num_pr_tag = f"{{{W}}}numPr"',
      '    ilvl_tag = f"{{{W}}}ilvl"',
      '    num_id_tag = f"{{{W}}}numId"',
      '    p_pr_tag = f"{{{W}}}pPr"',
      '    for tc in root.iter(f"{{{W}}}tc"):',
      '        for p in tc.iter(f"{{{W}}}p"):',
      '            ppr = p.find(p_pr_tag)',
      '            if ppr is None:',
      '                ppr = ET.SubElement(p, p_pr_tag)',
      '                p.insert(0, ppr)',
      '            num_pr = ppr.find(num_pr_tag)',
      '            if num_pr is not None: ppr.remove(num_pr)',
      '            num_pr = ET.SubElement(ppr, num_pr_tag)',
      '            ilvl = ET.SubElement(num_pr, ilvl_tag)',
      '            ilvl.set(f"{{{W}}}val", "0")',
      '            num_id = ET.SubElement(num_pr, num_id_tag)',
      '            num_id.set(f"{{{W}}}val", "0")',
      '    return ET.tostring(root, encoding="unicode", xml_declaration=False).encode("utf-8")',
      'tmp = src + ".patch"',
      'with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:',
      '    for item in zin.infolist():',
      '        data = zin.read(item.filename)',
      '        if item.filename == "word/document.xml":',
      '            data = patch_doc(data)',
      '        if item.filename == "word/styles.xml" and b\'styleId="Compact"\' not in data:',
      '            data = data.replace(b"</w:styles>", compact_xml + b"</w:styles>")',
      '        zout.writestr(item, data)',
      'os.replace(tmp, src)',
    ].join('\n');
    const child = spawn('python3', ['-c', script, docxPath, targetStyleId, COMPACT_STYLE_XML]);
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('patchDocxTableStyle timed out after 30s'));
    }, TIMEOUT_MS);
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    (child as unknown as NodeJS.EventEmitter).on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`patchDocxTableStyle spawn error: ${err.message}`));
    });
    (child as unknown as NodeJS.EventEmitter).on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`patchDocxTableStyle failed: ${stderr}`));
    });
  });
}

function runPandoc(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args);
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Pandoc timed out after 30s'));
    }, TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as unknown as NodeJS.EventEmitter).on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Pandoc spawn error: ${err.message}`));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as unknown as NodeJS.EventEmitter).on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const truncated = stderr.length > 500 ? stderr.slice(0, 500) + '\n[truncated]' : stderr;
      reject(new Error(`Pandoc exited with code ${code}: ${truncated}`));
    });
  });
}
