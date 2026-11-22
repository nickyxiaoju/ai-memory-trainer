"""Bounded, local document reader. stdin is the file; stdout is JSON or a single PNG."""

import io
import json
import math
import os
from pathlib import Path
import posixpath
import re
import resource
import signal
import struct
import subprocess
import sys
import tempfile
from xml.etree import ElementTree as ET
import zipfile
import zlib


MiB = 1024 * 1024
MAX_INPUT = 12 * MiB
MAX_PAGES = 200
MAX_TEXT = 500_000
MAX_PARAGRAPHS = 12_000
MAX_PARTS = 2048
MAX_INFLATED = 64 * MiB
MAX_XML = 8 * MiB
MAX_QUOTE = 72
MAX_HEIGHT = 4096
MAX_PIXELS = 8_000_000


class DocumentError(Exception):
    pass


BAD_XML = '文档结构无效，请用原应用重新导出。'
TOO_LONG = '正文或段落过多，请拆分文档后重试。'
TOO_MANY_PAGES = f'超过 {MAX_PAGES} 页或节，请拆分文档后重试。'
ENCRYPTED = '不支持加密文档，请先移除密码并另存副本。'
NO_TEXT = '没有可提取的正文，请检查文件；扫描件请先进行 OCR。'


def lower_limit(kind, value):
    bounds = [n for n in resource.getrlimit(kind) if n != resource.RLIM_INFINITY]
    limit = min(value, *bounds) if bounds else value
    resource.setrlimit(kind, (limit, limit))


class BoundedTree(ET.TreeBuilder):
    """Reject DTDs in any XML encoding; do not resolve entities, links or XInclude."""

    def __init__(self):
        super().__init__()
        self.nodes = self.depth = 0

    def start(self, tag, attrs):
        self.nodes += 1
        self.depth += 1
        if self.nodes > 180_000 or self.depth > 96:
            raise DocumentError('文档结构过大，请拆分或简化后重试。')
        return super().start(tag, attrs)

    def end(self, tag):
        self.depth -= 1
        return super().end(tag)

    def doctype(self, name, pubid, system):
        raise DocumentError('不支持含 DTD 的文档，请重新导出。')


def parse_xml(data):
    try:
        return ET.fromstring(data, parser=ET.XMLParser(target=BoundedTree()))
    except (ET.ParseError, LookupError, ValueError) as exc:
        raise DocumentError(BAD_XML) from exc


def excerpt(line):
    """A real, single-line prefix, not an ellipsis or a paraphrase."""
    text = line.strip()
    stop = re.search(r'[。！？!?]|\.(?=\s|$)', text[:MAX_QUOTE + 1])
    if stop and stop.end() <= MAX_QUOTE and any(c.isalnum() for c in text[:stop.end()]):
        return text[:stop.end()]
    if len(text) > MAX_QUOTE and not text[MAX_QUOTE].isspace():
        # Keep a whole final word when possible, without cutting CJK at an early space.
        cut = re.search(r'\s+\S*$', text[:MAX_QUOTE])
        if cut and cut.start() >= MAX_QUOTE // 2:
            return text[:cut.start()]
    return text[:MAX_QUOTE].rstrip()


def quote_score(quote):
    letters = sum(c.isalnum() for c in quote)
    return (any(c.isalpha() for c in quote), letters >= 6,
            quote.endswith(('。', '！', '？', '.', '!', '?')), min(letters, 18))


class Sections:
    def __init__(self):
        self.items = []
        self.chars = self.paragraphs = 0

    def add(self, title, paragraphs, *, anchor=None, empty_notice=None):
        if len(self.items) >= MAX_PAGES:
            raise DocumentError(TOO_MANY_PAGES)
        self.chars += sum(map(len, paragraphs))
        self.paragraphs += len(paragraphs)
        if self.chars > MAX_TEXT or self.paragraphs > MAX_PARAGRAPHS:
            raise DocumentError(TOO_LONG)
        section = {'title': title, 'paragraphs': paragraphs}
        if paragraphs:
            if anchor is None:
                # Keep the exercise on one line; a tab in Word is not a key the reader
                # should have to enter in the web text field.
                quotes = (excerpt(part) for p in paragraphs for line in p.splitlines()
                          for part in line.split('\t') if part.strip())
                quote, rects = max(quotes, key=quote_score), None
            else:
                quote, rects = anchor
            annotation = {'label': '原文摘录', 'quote': quote,
                          'explanation': '摘自本节正文，可对照原文核对字词和标点。'}
            if rects:
                annotation['rects'] = rects
            section.update(annotation=annotation, checkpoint={
                'kind': 'retype', 'prompt': '请逐字复现这段原文。',
                'hint': '保留原文中的空格和标点。', 'target': quote})
        else:
            section['paragraphs'] = [empty_notice] if empty_notice else []
        self.items.append(section)

    def result(self):
        if not self.chars:
            raise DocumentError(NO_TEXT)
        return {'sections': self.items}


class LogicalSections:
    """Word and plain text have no reliable physical viewport; keep paragraphs intact."""

    def __init__(self):
        self.sections = Sections()
        self.pending = []
        self.title = ''
        self.size = 0

    def flush(self):
        if self.pending:
            self.sections.add(self.title or f'第 {len(self.sections.items) + 1} 节', self.pending)
        self.pending = []
        self.title = ''
        self.size = 0

    def paragraph(self, text, heading=False):
        if not text.strip():
            return
        if heading or self.size + len(text) > 3600:
            self.flush()
        if heading:
            self.title = text.strip().splitlines()[0][:MAX_QUOTE]
        self.pending.append(text)
        self.size += len(text)

    def result(self):
        self.flush()
        return self.sections.result()


def analyse_txt(data):
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise DocumentError('TXT 需要 UTF-8 编码，请转换编码后重试。') from exc
    if re.search(r'[\x00-\x08\x0b\x0e-\x1f\x7f]', text) or data.startswith(b'%PDF-'):
        raise DocumentError('内容不是纯文本，请选择正确的格式或另存为 UTF-8 TXT。')
    if len(text) > MAX_TEXT:
        raise DocumentError(TOO_LONG)
    doc = LogicalSections()
    for part in text.replace('\r\n', '\n').replace('\r', '\n').split('\f'):
        doc.flush()
        for paragraph in re.split(r'\n(?:[ \t]*\n)+', part):
            doc.paragraph(paragraph)
    return doc.result()


# Both transitional and strict OOXML namespaces. Match namespaced tags, not prefixes.
W = ('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}',
     '{http://purl.oclc.org/ooxml/wordprocessingml/main}')
P = ('{http://schemas.openxmlformats.org/presentationml/2006/main}',
     '{http://purl.oclc.org/ooxml/presentationml/main}')
A = ('{http://schemas.openxmlformats.org/drawingml/2006/main}',
     '{http://purl.oclc.org/ooxml/drawingml/main}')
R = ('http://schemas.openxmlformats.org/officeDocument/2006/relationships',
     'http://purl.oclc.org/ooxml/officeDocument/relationships')
PKG = ('{http://schemas.openxmlformats.org/package/2006/relationships}',
       '{http://purl.oclc.org/ooxml/package/relationships}')
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'


def namespace(root, choices, name):
    for ns in choices:
        if root.tag == ns + name:
            return ns
    raise DocumentError(BAD_XML)


def walk(root, skip=()):
    """XML order, using only one representation of an AlternateContent subtree."""
    todo = [root]
    while todo:
        node = todo.pop()
        if node.tag in skip:
            continue
        if node.tag == MC + 'AlternateContent':
            branch = node.find(MC + 'Fallback')
            if branch is None:
                branch = node.find(MC + 'Choice')
            if branch is not None:
                todo.append(branch)
        else:
            yield node
            todo.extend(reversed(node))


class Package:
    def __init__(self, archive):
        self.archive = archive
        parts = archive.infolist()
        if len(parts) > MAX_PARTS or sum(i.file_size for i in parts) > MAX_INFLATED:
            raise DocumentError('压缩包展开过大或部件过多，请拆分文档。')
        self.names = set()
        for i in parts:
            if i.flag_bits & 1:
                raise DocumentError(ENCRYPTED)
            name = i.filename
            if (name in self.names or name != i.orig_filename or '\\' in name or
                    name.startswith('/') or '..' in name.split('/')):
                raise DocumentError(BAD_XML)
            if i.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise DocumentError('不支持此压缩方式，请用 Office 重新另存。')
            if name.lower().endswith('/vbaproject.bin'):
                raise DocumentError('不支持宏文档，请另存为无宏的 DOCX 或 PPTX。')
            self.names.add(name)

    def xml(self, name):
        if name not in self.names:
            raise DocumentError(BAD_XML)
        info = self.archive.getinfo(name)
        if info.file_size > MAX_XML:
            raise DocumentError('单个文档部件过大，请拆分文档。')
        with self.archive.open(info) as stream:
            data = stream.read(MAX_XML + 1)
        if len(data) != info.file_size or len(data) > MAX_XML:
            raise DocumentError(BAD_XML)
        return parse_xml(data)

    def relations(self, source, kind):
        directory, base = posixpath.split(source)
        root = self.xml(posixpath.join(directory, '_rels', base + '.rels'))
        ns = namespace(root, PKG, 'Relationships')
        result = {}
        for rel in root.findall(ns + 'Relationship'):
            if rel.get('Type') not in (R[0] + '/' + kind, R[1] + '/' + kind):
                continue  # Hyperlinks, templates, images, etc. are never opened.
            target, rid = rel.get('Target', ''), rel.get('Id')
            if (not rid or rid in result or not target or rel.get('TargetMode', 'Internal') != 'Internal'
                    or target.startswith('//') or any(c in target for c in ':\\?#')):
                raise DocumentError('文档引用无效或指向外部，请在原应用中重新另存。')
            path = target[1:] if target.startswith('/') else posixpath.join(directory, target)
            path = posixpath.normpath(path)
            if path not in self.names:
                raise DocumentError(BAD_XML)
            result[rid] = path
        return result

    def main(self, fallback):
        if '_rels/.rels' not in self.names:
            return fallback  # Conventional part name used by minimal producers.
        parts = self.relations('', 'officeDocument')
        if len(parts) != 1:
            raise DocumentError(BAD_XML)
        return next(iter(parts.values()))


def analyse_docx(pkg):
    root = pkg.xml(pkg.main('word/document.xml'))
    w = namespace(root, W, 'document')
    body = root.find(w + 'body')
    if body is None:
        raise DocumentError(BAD_XML)
    doc = LogicalSections()
    omitted = {w + 'del', w + 'moveFrom'}
    inline_omit = omitted | {w + 'p', w + 'pPr'}
    for para in walk(body, omitted):  # Includes paragraphs in table cells in document order.
        if para.tag != w + 'p':
            continue
        props = para.find(w + 'pPr')
        heading = False
        if props is not None:
            style = props.find(w + 'pStyle')
            outline = props.find(w + 'outlineLvl')
            heading = ((style is not None and re.fullmatch(r'heading\s*[1-9]|title|标题\s*[1-9]?',
                        style.get(w + 'val', ''), re.I)) or
                       (outline is not None and outline.get(w + 'val') in tuple('012345678')))
            before = props.find(w + 'pageBreakBefore')
            if before is not None and before.get(w + 'val') not in ('0', 'off', 'false'):
                doc.flush()
        pieces = []
        for child in para:
            for node in walk(child, inline_omit):
                if node.tag == w + 't':
                    pieces.append(node.text or '')  # w:r is formatting, not a word boundary.
                elif node.tag == w + 'tab':
                    pieces.append('\t')
                elif node.tag in (w + 'br', w + 'cr'):
                    pieces.append('\f' if node.get(w + 'type') == 'page' else '\n')
                elif node.tag == w + 'noBreakHyphen':
                    pieces.append('\u2011')
        for i, fragment in enumerate(''.join(pieces).split('\f')):
            if i:
                doc.flush()
            doc.paragraph(fragment, heading and i == 0)
        if props is not None and props.find(w + 'sectPr') is not None:
            doc.flush()
    return doc.result()


def analyse_pptx(pkg):
    main = pkg.main('ppt/presentation.xml')
    root = pkg.xml(main)
    p = namespace(root, P, 'presentation')
    ids = root.findall(p + 'sldIdLst/' + p + 'sldId')
    if len(ids) > MAX_PAGES:
        raise DocumentError(TOO_MANY_PAGES)
    slides = pkg.relations(main, 'slide')
    sections = Sections()
    seen = set()
    for i, slide_id in enumerate(ids, 1):
        rid = next((slide_id.get('{' + r + '}id') for r in R if '{' + r + '}id' in slide_id.attrib), None)
        path = slides.get(rid)
        if not path or path in seen:
            raise DocumentError(BAD_XML)
        seen.add(path)
        slide = pkg.xml(path)
        slide_ns = namespace(slide, P, 'sld')
        tree = slide.find(slide_ns + 'cSld/' + slide_ns + 'spTree')
        if tree is None:
            raise DocumentError(BAD_XML)
        a = A[P.index(slide_ns)]
        paragraphs = []
        for para in walk(tree):  # Shape-tree order; includes table cells and grouped shapes.
            if para.tag == a + 'p':
                text = ''.join((n.text or '') if n.tag == a + 't' else '\n'
                               for n in walk(para, {a + 'pPr'}) if n.tag in (a + 't', a + 'br'))
                if text.strip():
                    paragraphs.append(text)
        sections.add(f'第 {i} 张幻灯片', paragraphs, empty_notice='本张没有可提取的文字；未执行 OCR。')
    return sections.result()


def analyse_office(data, fmt):
    if data.startswith(b'\xd0\xcf\x11\xe0'):
        raise DocumentError('可能是加密或旧版 Office 文件，请另存为未加密的 DOCX 或 PPTX。')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            pkg = Package(archive)
            return analyse_docx(pkg) if fmt == 'docx' else analyse_pptx(pkg)
    except (zipfile.BadZipFile, NotImplementedError, EOFError, zlib.error, ValueError) as exc:
        raise DocumentError('Office 文件损坏或格式不符，请重新另存。') from exc


def offline_pdf_process():
    """On this Linux service, deny new sockets before parsing even the PDF metadata.

    Inherited by Poppler across exec. Its only inherited fds are local stdio files.
    Use the existing C runtime through the stdlib, not a sandbox package or a shell.
    """
    import ctypes as c
    import errno

    # Linux audit architecture, native socket syscall. Fail closed on an unknown ABI.
    abi = {'x86_64': (0xc000003e, 41), 'aarch64': (0xc00000b7, 198),
           'riscv64': (0xc00000f3, 198)}.get(os.uname().machine)
    unavailable = '本机无法启用离线 PDF 沙箱，请联系管理员。'
    if sys.platform != 'linux' or abi is None:
        raise DocumentError(unavailable)

    class Insn(c.Structure):
        _fields_ = [('code', c.c_ushort), ('jt', c.c_ubyte), ('jf', c.c_ubyte), ('k', c.c_uint32)]

    class Program(c.Structure):
        _fields_ = [('length', c.c_ushort), ('insns', c.POINTER(Insn))]

    deny, allow = 0x00050000 | errno.EPERM, 0x7fff0000
    ops = [(0x20, 0, 0, 4), (0x15, 1, 0, abi[0]), (0x06, 0, 0, deny),  # check seccomp_data.arch
           (0x20, 0, 0, 0), (0x54, 0, 0, 0x3fffffff),                 # load syscall, mask x32 bit
           (0x15, 1, 0, abi[1]), (0x15, 0, 1, 425),                  # socket / io_uring_setup
           (0x06, 0, 0, deny), (0x06, 0, 0, allow)]
    program = Program(len(ops), (Insn * len(ops))(*ops))
    prctl = c.CDLL(None).prctl
    if prctl(38, 1, 0, 0, 0) or prctl(22, 2, c.byref(program), 0, 0):  # NO_NEW_PRIVS; SECCOMP_FILTER
        raise DocumentError(unavailable)


# Fixed executable names, arguments and private local input path. These non-interactive
# Poppler utilities extract/display pages; they do not follow links or run PDF actions.
def poppler(tool, args, cwd, cap):
    def limits():
        lower_limit(resource.RLIMIT_CPU, 8)
        lower_limit(resource.RLIMIT_FSIZE, cap)

    env = {'PATH': os.defpath, 'LC_ALL': 'C', 'HOME': cwd, 'TMPDIR': cwd, 'XDG_CACHE_HOME': cwd}
    with tempfile.TemporaryFile(dir=cwd) as out, tempfile.TemporaryFile(dir=cwd) as err:
        try:
            result = subprocess.run([tool, *args], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                    stdout=out, stderr=err, timeout=10, preexec_fn=limits)
        except FileNotFoundError as exc:
            raise DocumentError('本机缺少 Poppler 工具，请联系管理员。') from exc
        except subprocess.TimeoutExpired as exc:
            raise DocumentError('PDF 处理超时，请拆分或简化后重试。') from exc
        if result.returncode:
            err.seek(0)
            diagnostic = err.read(8192).lower()
            if b'password' in diagnostic or b'encrypted' in diagnostic:
                raise DocumentError(ENCRYPTED)
            if b'page range' in diagnostic:
                raise DocumentError('页码超出范围，请选择文档中的页码。')
            raise DocumentError('无法处理此 PDF，请拆分文件或重新导出未加密的副本。')
        if out.tell() >= cap or err.tell() >= cap:
            raise DocumentError('PDF 处理结果过大，请拆分文档。')
        out.seek(0)
        return out.read(cap)


def pdf_geometry(cwd, number):
    first, last = (1, MAX_PAGES) if number is None else (number, number)
    data = poppler('pdfinfo', ['-f', str(first), '-l', str(last), 'input.pdf'], cwd, MiB)
    # pdfinfo prints arbitrary Info dictionary strings BEFORE its own summary fields.
    # Use the last summary, and only accept per-page information following it.
    summaries = list(re.finditer(rb'^Pages:[ \t]+(\d+)[ \t]*\r?\nEncrypted:[ \t]+(yes|no)\b', data, re.M))
    if not summaries:
        raise DocumentError('无法核实 PDF 页数或加密状态，请重新导出。')
    summary = summaries[-1]
    if summary[2] == b'yes':
        raise DocumentError(ENCRYPTED)
    count = int(summary[1])
    if count > MAX_PAGES:
        raise DocumentError(TOO_MANY_PAGES)
    if count < 1 or (number and number > count):
        raise DocumentError('页码超出范围，请选择文档中的页码。')
    details = data[summary.end():]
    rotations = {int(i): int(rot) for i, rot in re.findall(rb'^Page[ \t]+(\d+) rot:[ \t]+(-?\d+)', details, re.M)}
    geometry = {}
    for i, w, h in re.findall(rb'^Page[ \t]+(\d+) size:[ \t]+(\S+) x (\S+) pts', details, re.M):
        i, w, h = int(i), float(w), float(h)
        rot = rotations.get(i)
        if not all(math.isfinite(v) and v > 0 for v in (w, h)) or rot not in (0, 90, 180, 270):
            raise DocumentError('页面尺寸或旋转角度无效，请重新导出 PDF。')
        geometry[i] = (w, h, rot)
    if set(geometry) != set(range(first, min(last, count) + 1)):
        raise DocumentError('无法核实 PDF 页面尺寸，请重新导出。')
    return geometry


def viewport(page, geometry):
    # Poppler word coordinates are already rotated and crop-relative, but its XHTML
    # page width/height are normally *unrotated*. Check against independent pdfinfo data.
    w, h, rot = geometry
    bw, bh = float(page.get('width', 'nan')), float(page.get('height', 'nan'))
    swapped = rot in (90, 270)
    def matches(x, y):
        return math.isclose(bw, x, rel_tol=1e-5, abs_tol=1e-5) and math.isclose(bh, y, rel_tol=1e-5, abs_tol=1e-5)

    if matches(w, h):
        return (bh, bw) if swapped else (bw, bh)
    if swapped and matches(h, w):  # A producer that reports already-rotated dimensions.
        return bw, bh
    return None  # Disagreement must not produce a speculative highlight.


def word_rect(word, view):
    if not view:
        return None
    w, h = view
    x, y, r, b = (float(word.get(k, 'nan')) for k in ('xMin', 'yMin', 'xMax', 'yMax'))
    if not (0 <= x < r <= w and 0 <= y < b <= h):
        return None
    return [x / w, y / h, (r - x) / w, (b - y) / h]


# Hangul is deliberately excluded: Korean normally uses inter-word spaces.
CJK = re.compile(r'[\u2e80-\u9fff\uf900-\ufaff\U00020000-\U000323af]')


def line_separator(left, right):
    # These are adjacent *lines* in one Poppler block, not adjacent word boxes.
    marks = '，。！？；：、（）《》【】「」『』'
    if left in '-\u2010\u2011\u00ad' or ((left in marks or CJK.fullmatch(left)) and (right in marks or CJK.fullmatch(right))):
        return ''
    return ' '


XHTML = '{http://www.w3.org/1999/xhtml}'
POPLER_DTD = b'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'


def pdf_line(line, view):
    pieces, words = [], []
    end = 0
    for word in line.findall(XHTML + 'word'):
        text = (word.text or '').strip()
        if not text:
            continue
        # Distinct Poppler words on a line have a word boundary. Do not discard an
        # explicit space between two Chinese words just because both are ideographs.
        gap = ' ' if pieces else ''
        pieces.extend((gap, text))
        end += len(gap) + len(text)
        words.append((end, word))
    text = ''.join(pieces)
    quote = excerpt(text)
    rects = []
    for end, word in words:
        if end > MAX_QUOTE:
            break
        rects.append(word_rect(word, view))
        if end >= len(quote):
            # Never claim a partial-word rectangle. Extend to this word boundary.
            return text, (text[:end], rects if all(rects) else None)
    return text, (quote, None)


def analyse_pdf(cwd, geometry):
    data = poppler('pdftotext', ['-enc', 'UTF-8', '-bbox-layout', '-cropbox', 'input.pdf', '-'], cwd, 20 * MiB)
    # Strip only the fixed literal supplied by the utility; never load its external DTD.
    root = parse_xml(data.removeprefix(POPLER_DTD))
    pages = root.findall('.//' + XHTML + 'page')
    if len(pages) != len(geometry):
        raise DocumentError('PDF 页数与文本不一致，请重新导出。')
    sections = Sections()
    for i, page in enumerate(pages, 1):
        view = viewport(page, geometry[i])
        paragraphs, best, best_score = [], None, None
        # Flow -> block -> line is Poppler's reading order, not a global Y/X sort.
        for block in page.iter(XHTML + 'block'):
            pieces = []
            for line in block.findall(XHTML + 'line'):
                text, candidate = pdf_line(line, view)
                if not text:
                    continue
                if pieces:
                    pieces.append(line_separator(pieces[-1][-1], text[0]))
                pieces.append(text)
                quality = quote_score(candidate[0])
                score = (*quality[:2], candidate[1] is not None, *quality[2:])
                if best_score is None or score > best_score:
                    best, best_score = candidate, score
            if pieces:
                paragraphs.append(''.join(pieces))
        sections.add(f'第 {i} 页', paragraphs, anchor=best,
                     empty_notice='本页没有可提取的文字（可能是扫描图像或空白页）。请查看原页；未执行 OCR。')
    return sections.result()


def render_pdf(cwd, number, width, geometry):
    w, h, rot = geometry[number]
    if rot in (90, 270):
        w, h = h, w
    height = width * (h / w)
    if not math.isfinite(height) or height > MAX_HEIGHT or width * height > MAX_PIXELS:
        raise DocumentError('渲染尺寸过大，请减小宽度或裁剪页面后重试。')
    height = max(1, math.ceil(height))
    if width * height > MAX_PIXELS:
        raise DocumentError('渲染尺寸过大，请减小宽度后重试。')
    # Bound BOTH axes before rasterization. Cairo sometimes rounds a fractional
    # CropBox up by an extra pixel: trim only that right/bottom rounding fringe.
    png = poppler('pdftocairo', ['-png', '-singlefile', '-cropbox', '-f', str(number), '-l', str(number),
                  '-scale-to-x', str(width), '-scale-to-y', str(height), '-W', str(width), '-H', str(height),
                  'input.pdf', '-'], cwd, 32 * MiB)
    if (not png.startswith(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR') or len(png) < 33 or
            struct.unpack('>II', png[16:24]) != (width, height) or not png.endswith(b'IEND\xaeB`\x82')):
        raise DocumentError('未能生成指定尺寸的完整原页，请调整宽度或重新导出。')
    return png


def run(args):
    page = width = None
    if len(args) == 2 and args[0] == 'analyse' and args[1] in ('pdf', 'docx', 'pptx', 'txt'):
        fmt = args[1]
    elif len(args) == 3 and args[0] == 'render':
        if not all(re.fullmatch(r'[0-9]{1,4}', s) for s in args[1:]):
            raise DocumentError('请使用从 1 开始的整数页码，宽度须为 320 到 2400 像素。')
        page, width = map(int, args[1:])
        if not 1 <= page <= MAX_PAGES or not 320 <= width <= 2400:
            raise DocumentError(f'页码须为 1 到 {MAX_PAGES}，宽度须为 320 到 2400 像素。')
        fmt = 'pdf'
    else:
        raise DocumentError('请使用 analyse pdf|docx|pptx|txt，或 render 页码 宽度。')
    data = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise DocumentError('文件超过 12 MiB，请压缩或拆分后再导入。')
    if not data:
        raise DocumentError('文件为空，请选择有内容的文档。')
    if fmt == 'pdf':
        if not data.startswith(b'%PDF-'):
            raise DocumentError('文件不是 PDF，请检查格式或重新导出。')
        offline_pdf_process()
        with tempfile.TemporaryDirectory(prefix='local-reader-') as cwd:
            Path(cwd, 'input.pdf').write_bytes(data)
            geometry = pdf_geometry(cwd, page)
            if page is not None:
                return render_pdf(cwd, page, width, geometry)
            result = analyse_pdf(cwd, geometry)
    elif fmt == 'txt':
        result = analyse_txt(data)
    else:
        result = analyse_office(data, fmt)
    return json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def timeout(signum, frame):
    raise DocumentError('处理超时，请拆分文档后重试。')


def main():
    try:
        lower_limit(resource.RLIMIT_AS, 512 * MiB)
        lower_limit(resource.RLIMIT_CPU, 30)
        lower_limit(resource.RLIMIT_CORE, 0)
        lower_limit(resource.RLIMIT_NOFILE, 64)
        signal.signal(signal.SIGALRM, timeout)
        signal.alarm(25)
        sys.stdout.buffer.write(run(sys.argv[1:]))
        sys.stdout.buffer.flush()
        return 0
    except DocumentError as exc:
        message = str(exc)
    except (OSError, MemoryError, OverflowError, ValueError, subprocess.SubprocessError):
        message = '无法在资源限制内读取文件，请拆分或重新导出。'
    finally:
        signal.alarm(0)
    sys.stderr.buffer.write((message + '\n').encode('utf-8'))
    return 1


if __name__ == '__main__':
    sys.exit(main())
