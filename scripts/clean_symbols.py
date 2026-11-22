import os
import re

root = r'd:\Personal Projects\ApkBolt\apkstart'

cjk_map = {
    '\uff08': '(',
    '\uff09': ')',
    '\uff1a': ': ',
    '\uff0c': ', ',
    '\u3001': ', ',
    '\u3002': '. ',
    '\u300c': '"',
    '\u300d': '"',
    '\u300e': '"',
    '\u300f': '"',
    '\u3010': '[',
    '\u3011': ']',
    '\u300a': '<',
    '\u300b': '>',
    '\u201c': '"',
    '\u201d': '"',
    '\u2018': "'",
    '\u2019': "'",
    '\u2014': '-',
    '\u2013': '-',
    '\u2026': '...',
    '\u00b7': ' - ',
    '\u3000': ' ',
    '\uff01': '!',
    '\uff1f': '?',
    '\uff1b': '; '
}

def clean_text(text):
    for k, v in cjk_map.items():
        text = text.replace(k, v)
    return text

count = 0
for dirpath, dirnames, filenames in os.walk(root):
    if any(p in dirpath for p in ['.git', 'node_modules', 'dist']):
        continue
    for f in filenames:
        ext = os.path.splitext(f)[1].lower()
        if ext in ['.js', '.html', '.css', '.json', '.md', '.py', '.ps1', '.yml', '.yaml', '.txt', '.iss']:
            p = os.path.join(dirpath, f)
            try:
                with open(p, 'r', encoding='utf-8', errors='ignore') as fp:
                    orig = fp.read()
                cleaned = clean_text(orig)
                if cleaned != orig:
                    with open(p, 'w', encoding='utf-8', newline='') as fp:
                        fp.write(cleaned)
                    count += 1
            except Exception as e:
                print('Error processing', p, e)

print(f'Cleaned CJK punctuation in {count} files.')

