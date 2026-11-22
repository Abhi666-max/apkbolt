"""
Bulk-rename all remaining ApkBolt brand tokens to ApkBolt equivalents.
Skips: .git, node_modules, dist directories.
"""
import os
import re

ROOT = r'd:\Personal Projects\ApkBolt\apkbolt'

# Order matters: more-specific patterns first
REPLACEMENTS = [
    # Exe/uninstall file names
    ('Uninstall ApkBolt.exe',  'Uninstall ApkBolt.exe'),
    ('ApkBolt.exe',            'ApkBolt.exe'),
    # Asset names in manifests/comments
    ('ApkBolt-v',              'ApkBolt-v'),
    ('ApkBolt_',               'ApkBolt_'),
    # env var prefix (keep functional, just rename brand)
    ('APKBOLT_',               'APKBOLT_'),
    # Shared/temp dirs
    ('ApkBoltShared',          'ApkBoltShared'),
    ('apkbolt-install',        'apkbolt-install'),
    ('apkbolt-synth',          'apkbolt-synth'),
    ('apkbolt-guard',          'apkbolt-guard'),
    ('apkbolt-upd-',           'apkbolt-upd-'),
    ('apkbolt-tmp-',           'apkbolt-tmp-'),
    ('apkbolt selftest',       'apkbolt selftest'),
    # AVD / emulator names
    ("'apkbolt'",              "'apkbolt'"),
    ('"apkbolt"',              '"apkbolt"'),
    ('apkbolt,',               'apkbolt,'),
    # Window title / class checks (exact string matches)
    ("'ApkBolt'",              "'ApkBolt'"),
    ('"ApkBolt"',              '"ApkBolt"'),
    # AppData / path segments
    ("'apkbolt'",              "'apkbolt'"),
    ('"apkbolt"',              '"apkbolt"'),
    ('/apkbolt/',              '/apkbolt/'),
    ("\\\\apkbolt\\\\",        "\\\\apkbolt\\\\"),
    ("\\\\apkbolt'",           "\\\\apkbolt'"),
    # Port/process name references
    ('apkbolt:5554',           'apkbolt:5554'),
    ('apkbolt5554',            'apkbolt5554'),
    # Comments/strings
    ('ApkBolt ',               'ApkBolt '),
    ('ApkBolt,',               'ApkBolt,'),
    ('ApkBolt.',               'ApkBolt.'),
    ('ApkBolt-',               'ApkBolt-'),
    ('ApkBolt\n',              'ApkBolt\n'),
    ('ApkBolt\r',              'ApkBolt\r'),
    ("'ApkBolt",               "'ApkBolt"),
    ('"ApkBolt',               '"ApkBolt'),
    ('`ApkBolt',               '`ApkBolt'),
    # catch-all for remaining bare ApkBolt
    ('ApkBolt',                'ApkBolt'),
    # lowercase
    ('apkbolt',                'apkbolt'),
]

EXTS = {'.js', '.html', '.css', '.json', '.md', '.py', '.ps1',
        '.yml', '.yaml', '.txt', '.iss', '.ts', '.sh'}
SKIP_DIRS = {'.git', 'node_modules', 'dist'}

def should_skip(path):
    parts = path.replace('\\', '/').split('/')
    return any(s in SKIP_DIRS for s in parts)

count_files = 0
count_replacements = 0

for dirpath, dirnames, filenames in os.walk(ROOT):
    # Prune skip dirs in-place
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    if should_skip(dirpath):
        continue
    for fname in filenames:
        ext = os.path.splitext(fname)[1].lower()
        if ext not in EXTS:
            continue
        fpath = os.path.join(dirpath, fname)
        try:
            with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            print(f'  [skip] {fpath}: {e}')
            continue

        original = content
        for old, new in REPLACEMENTS:
            content = content.replace(old, new)

        if content != original:
            with open(fpath, 'w', encoding='utf-8', newline='') as f:
                f.write(content)
            count_files += 1
            count_replacements += (original.count('ApkBolt') + original.count('apkbolt')
                                   + original.count('APKSTART'))

print(f'Done. Renamed tokens in {count_files} files (~{count_replacements} occurrences).')
