"""Black-box CLI tests. Fixtures are generated here, not downloaded or committed."""

import io
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'read_document.py'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'


def package(parts):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, content in parts.items():
            z.writestr(name, content)
    return data.getvalue()


def docx(body):
    return package({'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'})


def slide(text):
    return (f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:txBody>'
            f'{text}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>')


def deck(*, external=False):
    mode = 'TargetMode="External"' if external else ''
    return package({
        '_rels/.rels': f'<Relationships xmlns="{PKG}"><Relationship Id="o" Type="{R}/officeDocument" '
                       'Target="ppt/deck.xml"/></Relationships>',
        'ppt/deck.xml': f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst>'
                        '<p:sldId id="600" r:id="late"/><p:sldId id="257" r:id="early"/>'
                        '<p:sldId id="350" r:id="pic"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/deck.xml.rels': f'<Relationships xmlns="{PKG}"><Relationship Id="early" Type="{R}/slide" '
                                   f'Target="slides/slide2.xml"/><Relationship Id="late" Type="{R}/slide" '
                                   f'{mode} Target="/ppt/slides/slide10.xml"/><Relationship Id="pic" '
                                   f'Type="{R}/slide" Target="slides/slide3.xml"/></Relationships>',
        'ppt/slides/slide2.xml': slide('<a:p><a:r><a:t>Next slide</a:t></a:r></a:p>'),
        'ppt/slides/slide3.xml': slide(''),
        'ppt/slides/slide10.xml': slide('<a:p><a:r><a:t>First</a:t></a:r><a:r><a:t>  slide.</a:t></a:r>'
                                        '<a:br/><a:r><a:t>第二行</a:t></a:r></a:p>'),
        'ppt/slides/slide1.xml': slide('<a:p><a:r><a:t>Orphan</a:t></a:r></a:p>')})


def pdf(streams, *, rotate=0, crop=(45, 50, 285, 220), media=(0, 0, 320, 280), extra_info=b''):
    def box(coords):
        return ' '.join(map(str, coords)).encode()

    kids = ' '.join(f'{4 + 2*i} 0 R' for i in range(len(streams)))
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               f'<< /Type /Pages /Count {len(streams)} /Kids [{kids}] >>'.encode(),
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for stream in streams:
        objects += [b'<< /Type /Page /Parent 2 0 R /MediaBox [' + box(media) + b'] /CropBox [' + box(crop) +
                    b'] /Rotate %d /Resources << /Font << /F 3 0 R >> >> /Contents %d 0 R >>' % (rotate, len(objects) + 2),
                    b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream']
    info = b''
    if extra_info:
        objects.append(extra_info)
        info = b'/Info %d 0 R' % len(objects)
    data, offsets = bytearray(b'%PDF-1.4\n'), []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += b'%d 0 obj\n' % i + obj + b'\nendobj\n'
    start = len(data)
    data += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    data += b''.join(b'%010d 00000 n \n' % n for n in offsets)
    data += b'trailer\n<< /Root 1 0 R %s /Size %d >>\nstartxref\n%d\n%%%%EOF\n' % (info, len(objects) + 1, start)
    return bytes(data)


TEXT = b'BT /F 16 Tf 80 175 Td (Hello source.) Tj ET'
# Actual inline raster image and no text operators.
IMAGE = b'q 40 0 0 40 90 90 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID \x22\x33\x44 EI Q'


def png_ink(png):
    """Read dark pixels from Cairo's 8-bit noninterlaced RGB PNG (no imaging library)."""
    w, h, depth, kind, _, _, interlace = struct.unpack_from('>IIBBBBB', png, 16)
    assert (depth, kind, interlace) == (8, 2, 0)
    data = bytearray()
    pos = 8
    while pos < len(png):
        size = struct.unpack_from('>I', png, pos)[0]
        if png[pos + 4:pos + 8] == b'IDAT':
            data.extend(png[pos + 8:pos + 8 + size])
        pos += size + 12
    raw = zlib.decompress(data)
    stride = w * 3
    prev = bytearray(stride)
    ink = []
    for y in range(h):
        pos = y * (stride + 1)
        mode = raw[pos]
        row = bytearray(raw[pos + 1:pos + 1 + stride])
        for i in range(stride):
            left = row[i - 3] if i >= 3 else 0
            above = prev[i]
            if mode == 1:
                pred = left
            elif mode == 2:
                pred = above
            elif mode == 3:
                pred = (left + above) // 2
            elif mode == 4:
                diag = prev[i - 3] if i >= 3 else 0
                p = left + above - diag
                pred = min((left, above, diag), key=lambda v: abs(p - v))
            else:
                assert mode == 0
                pred = 0
            row[i] = (row[i] + pred) & 255
        ink.extend((x, y) for x in range(w) if row[3*x] < 80)
        prev = row
    return w, h, ink


class ReaderCLI(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def cli(self, data, *args, success=True):
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), *args], input=data, capture_output=True,
                                env={**os.environ, 'TMPDIR': str(self.tmp)}, timeout=32)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(result.stderr, b'')
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b'')
            self.assertRegex(result.stderr.decode(), r'[\u4e00-\u9fff]')
            self.assertLess(len(result.stderr), 300)
        self.assertEqual(list(self.tmp.glob('local-reader-*')), [])
        return result.stdout if success else result.stderr.decode()

    def sections(self, data, fmt):
        result = json.loads(self.cli(data, 'analyse', fmt))['sections']
        checkpoints = 0
        for section in result:
            if 'checkpoint' in section:
                checkpoints += 1
                cp = section['checkpoint']
                quote = section['annotation']['quote']
                self.assertEqual(cp['kind'], 'retype')
                self.assertEqual(cp['target'], quote)
                self.assertTrue(0 < len(quote) <= 72)
                self.assertTrue(any(quote in p for p in section['paragraphs']))
        self.assertGreater(checkpoints, 0)
        return result

    def test_txt_preserves_significant_spaces_and_utf8(self):
        sections = self.sections('\ufeffFirst  sentence.\r\n第二行\r\n  \r\nNext.\f末节'.encode(), 'txt')
        self.assertEqual([s['paragraphs'] for s in sections], [['First  sentence.\n第二行', 'Next.'], ['末节']])
        self.assertNotIn('rects', sections[0]['annotation'])
        indented, = self.sections(b'   indented\ttext.  ', 'txt')
        self.assertEqual(indented['paragraphs'], ['   indented\ttext.  '])
        self.assertNotIn('\t', indented['checkpoint']['target'])
        for data in (b'\xff', b'a\x00b', b'  \n\t', b''):
            self.cli(data, 'analyse', 'txt', success=False)

    def test_docx_runs_tables_headings_and_breaks(self):
        body = ('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>起点</w:t></w:r></w:p>'
                '<w:p><w:r><w:t>Two</w:t><w:t xml:space="preserve">  words.</w:t></w:r>'
                '<w:r><w:tab/><w:t>&lt;literal&gt;</w:t><w:br/><w:t>换行</w:t></w:r>'
                '<w:instrText>not displayed</w:instrText><w:del><w:r><w:t>deleted</w:t></w:r></w:del></w:p>'
                '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
                '<w:p><w:r><w:br w:type="page"/><w:t>Next page</w:t></w:r></w:p>'
                '<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>末节</w:t></w:r></w:p>')
        s = self.sections(docx(body), 'docx')
        self.assertEqual(s[0]['title'], '起点')
        self.assertEqual([v['paragraphs'] for v in s], [['起点', 'Two  words.\t<literal>\n换行', 'Cell'], ['Next page'], ['末节']])

    def test_pptx_uses_relations_not_zip_order(self):
        s = self.sections(deck(), 'pptx')
        self.assertEqual(s[0]['paragraphs'], ['First  slide.\n第二行'])
        self.assertEqual(s[1]['paragraphs'], ['Next slide'])
        self.assertNotIn('checkpoint', s[2])
        self.assertIn('OCR', s[2]['paragraphs'][0])
        self.cli(deck(external=True), 'analyse', 'pptx', success=False)

    def test_xml_and_zip_limits(self):
        xml = f'<!DOCTYPE document><w:document xmlns:w="{W}"><w:body/></w:document>'
        self.assertIn('DTD', self.cli(package({'word/document.xml': xml.encode('utf-16')}), 'analyse', 'docx', success=False))
        self.cli(package({'word/document.xml': '<document><p>wrong namespace</p></document>'}), 'analyse', 'docx', success=False)
        self.cli(package({f'p{i}': '' for i in range(2049)}), 'analyse', 'docx', success=False)
        part = b' ' * (8 * 1024 * 1024)
        self.cli(package({f'p{i}': part for i in range(9)}), 'analyse', 'pptx', success=False)
        self.cli(package({'word/document.xml': part + b' '}), 'analyse', 'docx', success=False)
        self.cli(b'\xd0\xcf\x11\xe0', 'analyse', 'docx', success=False)
        self.cli(b'Not a ZIP.', 'analyse', 'pptx', success=False)

    def test_input_text_and_cli_bounds(self):
        self.assertIn('12 MiB', self.cli(b'x' * (12 * 1024 * 1024 + 1), 'analyse', 'txt', success=False))
        self.cli(b'x' * 500001, 'analyse', 'txt', success=False)
        self.cli(b'a', 'analyse', 'html', success=False)
        self.cli(b'not a PDF', 'analyse', 'pdf', success=False)
        for page, width in [('0', '320'), ('1', '319'), ('1', '2401'), ('one', '320')]:
            self.cli(b'', 'render', page, width, success=False)

    def test_pdf_paragraphs_physical_pages_and_image(self):
        content = (b'BT /F 12 Tf 60 195 Td (First source paragraph.) Tj 0 -14 Td (A second line.) Tj '
                   b'0 -52 Td (Separate last paragraph.) Tj ET')
        data = pdf([content, IMAGE, TEXT])
        s = self.sections(data, 'pdf')
        self.assertEqual(len(s), 3)
        self.assertEqual(s[0]['paragraphs'], ['First source paragraph. A second line.', 'Separate last paragraph.'])
        self.assertEqual(s[2]['paragraphs'], ['Hello source.'])
        self.assertNotIn('annotation', s[1])
        self.assertNotIn('checkpoint', s[1])
        self.assertIn('OCR', s[1]['paragraphs'][0])
        image = self.cli(data, 'render', '2', '320')
        self.assertTrue(png_ink(image)[2])
        self.assertIn('OCR', self.cli(pdf([IMAGE]), 'analyse', 'pdf', success=False))
        self.cli(data, 'render', '4', '320', success=False)

    def test_pdf_crop_and_rotation_align_with_rendered_ink(self):
        for rot in (0, 90, 180, 270):
            with self.subTest(rotation=rot):
                data = pdf([TEXT], rotate=rot)
                s, = self.sections(data, 'pdf')
                self.assertEqual(s['annotation']['quote'], 'Hello source.')
                rects = s['annotation']['rects']
                w, h, ink = png_ink(self.cli(data, 'render', '1', '320'))
                self.assertEqual((w, h), (320, 452 if rot % 180 else 227))
                self.assertGreater(len(ink), 50)
                covered = set()
                for x, y, rw, rh in rects:
                    self.assertTrue(0 <= x < x + rw <= 1 and 0 <= y < y + rh <= 1)
                    hits = {(px, py) for px, py in ink if x*w-1 <= px <= (x+rw)*w+1 and y*h-1 <= py <= (y+rh)*h+1}
                    self.assertTrue(hits)
                    covered.update(hits)
                self.assertGreaterEqual(len(covered) / len(ink), 0.98)

    def test_fractional_cropboxes_keep_requested_raster_width(self):
        for w, h, rotation, width in [(595.28, 841.89, 0, 321), (595.28, 841.89, 0, 900),
                                      (612.125, 792.999, 90, 813)]:
            box = (0, 0, w, h)
            png = self.cli(pdf([TEXT], media=box, crop=box, rotate=rotation), 'render', '1', str(width))
            ratio = w / h if rotation else h / w
            self.assertEqual(struct.unpack_from('>II', png, 16), (width, math.ceil(width * ratio)))

    def test_pdf_page_count_extremes_and_partial_word(self):
        self.cli(pdf([TEXT] * 201), 'analyse', 'pdf', success=False)
        skinny = (0, 0, 2, 9000)
        self.cli(pdf([TEXT], crop=skinny, media=skinny), 'render', '1', '320', success=False)
        box = (0, 0, 240, 320)
        png = self.cli(pdf([TEXT], crop=box, media=box), 'render', '1', '2400')
        self.assertEqual(struct.unpack_from('>II', png, 16), (2400, 3200))
        box = (0, 0, 1200, 240)
        s, = self.sections(pdf([b'BT /F 12 Tf 50 90 Td (' + b'W' * 90 + b') Tj ET'], media=box, crop=box), 'pdf')
        self.assertNotIn('rects', s['annotation'])

    @unittest.skipUnless(shutil.which('gs'), 'Ghostscript is optional for generating encrypted fixtures')
    def test_encrypted_pdf_including_empty_user_password(self):
        for password in ('', 'test'):
            outfile = self.tmp / 'protected.pdf'
            subprocess.run(['gs', '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite',
                            '-dEncryptionR=3', '-dKeyLength=128', '-sOwnerPassword=owner',
                            '-sUserPassword=' + password, '-sOutputFile=' + str(outfile), '-'],
                           input=pdf([TEXT]), capture_output=True, check=True, timeout=10)
            data = outfile.read_bytes()
            for args in [('analyse', 'pdf'), ('render', '1', '320')]:
                self.assertIn('加密', self.cli(data, *args, success=False))


if __name__ == '__main__':
    unittest.main()
