import re, hashlib, base64, sys

path = sys.argv[1]
html = open(path).read()
script = re.search(r"<script>(.*?)</script>", html, re.S).group(1)
digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
policy = (
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; "
    f"script-src 'sha256-{digest}'; base-uri 'none'; form-action 'none'"
)
meta = f'<meta http-equiv="Content-Security-Policy" content="{policy}">'
html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n', "", html)
html = html.replace('<meta name="robots"', meta + '\n<meta name="robots"', 1)
open(path, "w").write(html)
print(digest[:12])
