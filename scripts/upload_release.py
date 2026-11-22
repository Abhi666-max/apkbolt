import subprocess
import json
import os
import sys
import urllib.request
import urllib.error

def get_token():
    res = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, check=True)
    return res.stdout.strip()

def main():
    token = get_token()
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ApkBolt-Uploader'
    }

    # 1. Get release info
    rel_url = 'https://api.github.com/repos/Abhi666-max/apkbolt/releases/tags/v0.6.3'
    req = urllib.request.Request(rel_url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        release_data = json.loads(resp.read().decode('utf-8'))

    print(f"Release ID: {release_data['id']}, Name: {release_data.get('name')}")
    upload_url_template = release_data['upload_url'] # e.g. https://uploads.github.com/.../assets{?name,label}
    upload_url_base = upload_url_template.split('{')[0]

    asset_file = os.path.abspath('dist/ApkBolt-v0.6.3-portable.zip')
    asset_name = os.path.basename(asset_file)
    asset_size = os.path.getsize(asset_file)
    print(f"Asset: {asset_name} ({asset_size / (1024*1024):.2f} MB)")

    # 2. Check existing assets and delete if duplicate
    for asset in release_data.get('assets', []):
        if asset['name'] == asset_name:
            print(f"Deleting existing asset ID: {asset['id']}")
            del_req = urllib.request.Request(asset['url'], headers=headers, method='DELETE')
            urllib.request.urlopen(del_req)
            print("Deleted successfully.")

    # 3. Upload asset
    upload_url = f"{upload_url_base}?name={asset_name}"
    print(f"Uploading to: {upload_url}")

    upload_headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/zip',
        'Content-Length': str(asset_size),
        'User-Agent': 'ApkBolt-Uploader'
    }

    class ProgressReader:
        def __init__(self, filepath, total_size):
            self.f = open(filepath, 'rb')
            self.total = total_size
            self.read_bytes = 0
            self.last_pct = -1

        def read(self, size=-1):
            chunk = self.f.read(size)
            self.read_bytes += len(chunk)
            pct = int((self.read_bytes / self.total) * 100)
            if pct != self.last_pct and pct % 10 == 0:
                print(f"Upload progress: {pct}% ({self.read_bytes / (1024*1024):.1f}/{self.total / (1024*1024):.1f} MB)", flush=True)
                self.last_pct = pct
            return chunk

        def __len__(self):
            return self.total

    reader = ProgressReader(asset_file, asset_size)
    req = urllib.request.Request(upload_url, data=reader, headers=upload_headers, method='POST')

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            print("Upload completed successfully!")
            print(f"Download URL: {res_data.get('browser_download_url')}")
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.reason}")
        print(e.read().decode('utf-8'))
        sys.exit(1)
    finally:
        reader.f.close()

if __name__ == '__main__':
    main()

