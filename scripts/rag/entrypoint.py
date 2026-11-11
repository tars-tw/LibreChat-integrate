"""Start rag_api with its OpenAI embeddings key read from pwc_tars.

rag_api reads RAG_OPENAI_API_KEY once, at import, so the key has to be in the environment
before `python main.py` runs. This reads pwc_tars sys_config KEY_OPEN_AI_API (the row
LibreChat's `${tars:KEY_OPEN_AI_API}` resolves to) and then execs the given command, so the
key lives only in pwc_tars. A key rotated there takes effect on the next container start.

A RAG_OPENAI_API_KEY already set in the environment wins. Without one, LibreChat's .env
would hand rag_api OPENAI_API_KEY=user_provided as its key.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SYSCONFIG_KEY = 'KEY_OPEN_AI_API'
LOOPBACK_HOSTS = ('localhost', '127.0.0.1', '[::1]')
ATTEMPTS = 24
RETRY_SECONDS = 5


def log(message):
    print(f'[rag-entrypoint] {message}', file=sys.stderr, flush=True)


def tars_base_url():
    """TARS_AUTH_URL names pwc_tars as the LibreChat host sees it; loopback means the host."""
    explicit = os.environ.get('RAG_TARS_URL', '').strip()
    if explicit:
        return explicit.rstrip('/')
    parsed = urllib.parse.urlsplit(os.environ.get('TARS_AUTH_URL', '').strip())
    if not parsed.scheme or not parsed.hostname:
        return ''
    netloc = parsed.netloc
    for host in LOOPBACK_HOSTS:
        if netloc == host or netloc.startswith(f'{host}:'):
            netloc = 'host.docker.internal' + netloc[len(host):]
            break
    return f'{parsed.scheme}://{netloc}'.rstrip('/')


def read_key(base_url):
    query = urllib.parse.urlencode({'key': SYSCONFIG_KEY})
    url = f'{base_url}/api/settings/get_sys_config?{query}'
    with urllib.request.urlopen(url, timeout=10) as response:
        row = json.load(response)
    if isinstance(row, list):
        row = row[0] if row else {}
    value = str(row.get('value') or '').strip()
    if row.get('status', 'active') != 'active' or not value:
        raise ValueError(f'{SYSCONFIG_KEY} is empty or inactive in pwc_tars')
    return value


def fetch_key(base_url):
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return read_key(base_url)
        except ValueError:
            raise
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise ValueError(f'{SYSCONFIG_KEY} is not a pwc_tars sys_config row') from error
            log(f'pwc_tars answered {error.code} ({attempt}/{ATTEMPTS})')
            if attempt < ATTEMPTS:
                time.sleep(RETRY_SECONDS)
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as error:
            log(f'pwc_tars not reachable at {base_url} ({attempt}/{ATTEMPTS}): {error}')
            if attempt < ATTEMPTS:
                time.sleep(RETRY_SECONDS)
    raise RuntimeError(f'could not read {SYSCONFIG_KEY} from pwc_tars at {base_url}')


def main():
    command = sys.argv[1:] or ['python', 'main.py']
    provider = os.environ.get('EMBEDDINGS_PROVIDER', 'openai').strip().lower()
    if provider == 'openai' and not os.environ.get('RAG_OPENAI_API_KEY', '').strip():
        base_url = tars_base_url()
        if not base_url:
            log('TARS_AUTH_URL (or RAG_TARS_URL) is not set; cannot read the embeddings key')
            sys.exit(1)
        try:
            os.environ['RAG_OPENAI_API_KEY'] = fetch_key(base_url)
        except (ValueError, RuntimeError) as error:
            log(str(error))
            sys.exit(1)
        log(f'using pwc_tars {SYSCONFIG_KEY} from {base_url}')
    os.execvp(command[0], command)


if __name__ == '__main__':
    main()
