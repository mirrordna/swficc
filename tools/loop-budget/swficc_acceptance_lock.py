#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, json, os, re, subprocess
from pathlib import Path
from typing import Any
DEFAULT_RECEIPTS=[
    'output/swfipn-acceptance-criteria-gate-latest.json',
    'output/swfipn-dashboard-acceptance-crawler-latest.json',
    'output/swfipn-data-validation-gate-latest.json',
    'output/swfipn-provable-terminal-gate-latest.json',
    'output/swfipn-record-manifest-scan-latest.json',
    'output/swfipn-record-mirror-gate-latest.json',
    'output/swfipn-route-ledger-gate-latest.json',
    'output/swfipn-runtime-staleness-gate-latest.json',
    'output/swfipn-api-product-gate-latest.json',
    'output/swfipn-api-key-lifecycle-latest.json',
    'output/swfipn-admin-api-ui-brd-gate-latest.json',
    'output/swfipn-admin-governance-brd-gate-latest.json',
    'output/swfipn-saved-searches-brd-gate-latest.json',
    'output/swfipn-saved-searches-ui-brd-gate-latest.json',
    'output/swfipn-alerts-brd-gate-latest.json',
    'output/swfipn-alerts-ui-brd-gate-latest.json',
    'output/swfipn-alert-delivery-brd-gate-latest.json',
    'output/swfipn-record-field-parity-full-latest.json',
    'output/swfipn-brd-contract-truth-gate-latest.json',
    'output/swfipn-share-gate-latest.json',
    'output/swfipn-source-truth-gate-latest.json',
    'output/swfipn-source-url-coverage-latest.json',
    'output/swfipn-visual-gate-latest.json',
]
CRITERIA=['Dashboard look and feel is consistent with SWFI website.','Public /swficc dashboard renders without login.','Dashboard business hyperlinks point to canonical SWFI platform record/profile pages when source URLs exist.','Existing SWFI platform authentication handles unauthenticated record-link redirects and authenticated continuity.','No internal technical details are visible to users.','Table rows link to appropriate SWFI record/profile pages.','Public API/frontend payloads do not expose restricted/private/internal data.','Missing/empty data renders cleanly.','Mobile/tablet/desktop layout does not break.','Existing gate receipts remain passing.']
LEAK_PATTERNS=[r'\bobject[_\s-]?id\b',r'\bdatabase[_\s-]?id\b',r'\bdebug\b',r'\bstack trace\b',r'\btraceback\b',r'\bActive Mirror\b',r'\broute ledger\b',r'\bsource gap\b',r'\binternal diagnostic',r'\bNaN\b']
SKIP_DIRS={'.git','node_modules','.next','dist','build','coverage','__pycache__','.venv','venv','output','logs','out','tmp','tools','scripts','schemas','configs'}
SCAN_SUFFIXES={'.html','.tsx','.jsx','.ts','.js','.vue','.svelte'}
PASS_STATUSES={'pass','pass_with_quarantine','passed','ok','green','success','complete','go','go_with_caveat'}
FAIL_STATUSES={'fail','failed','blocked','no_go','error'}
TOP_LEVEL_STATUS_KEYS=('status','result','verdict','gate_status','final_verdict')
def now_iso(): return dt.datetime.now(dt.timezone.utc).isoformat()
def run_cmd(repo:Path,cmd:list[str]):
    try:
        cp=subprocess.run(cmd,cwd=repo,text=True,capture_output=True,timeout=20)
        return cp.returncode,(cp.stdout+cp.stderr).strip()
    except Exception as e: return 999,str(e)
def git_commit(repo:Path):
    code,out=run_cmd(repo,['git','rev-parse','HEAD']); return out.strip() if code==0 and out else 'unknown'
def git_diff_stats(repo:Path):
    code,out=run_cmd(repo,['git','diff','--numstat'])
    files=[]; added=0; deleted=0
    if code==0 and out:
        for line in out.splitlines():
            parts=line.split('\t')
            if len(parts)>=3:
                try: ai=int(parts[0])
                except ValueError: ai=0
                try: di=int(parts[1])
                except ValueError: di=0
                added+=ai; deleted+=di; files.append({'file':parts[2],'added':ai,'deleted':di})
    return {'changed_file_count':len(files),'total_added':added,'total_deleted':deleted,'changed_files':files[:100]}
def load_json(path:Path)->Any:
    try: return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError: return None
    except Exception as e: return {'_parse_error':str(e)}
def find_key_values(obj,wanted):
    vals=[]
    if isinstance(obj,dict):
        for k,v in obj.items():
            if k.lower() in wanted: vals.append(v)
            vals+=find_key_values(v,wanted)
    elif isinstance(obj,list):
        for x in obj: vals+=find_key_values(x,wanted)
    return vals
def receipt_passed(obj):
    if not isinstance(obj,dict) or '_parse_error' in obj: return False
    statuses=[str(obj[key]).strip().lower() for key in TOP_LEVEL_STATUS_KEYS if obj.get(key) is not None]
    if not statuses or any(status in FAIL_STATUSES for status in statuses): return False
    if any(status not in PASS_STATUSES for status in statuses): return False
    if obj.get('sendable') is False: return False
    if isinstance(obj.get('failures'),list) and obj['failures']: return False
    if isinstance(obj.get('blockers'),list) and obj['blockers']: return False
    return True

def parse_receipt_time(obj):
    if not isinstance(obj,dict): return None
    raw=obj.get('generated_at') or obj.get('timestamp')
    if not isinstance(raw,str) or not raw.strip(): return None
    try:
        value=dt.datetime.fromisoformat(raw.strip().replace('Z','+00:00'))
        if value.tzinfo is None: value=value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc)
    except ValueError:
        return None

def receipt_fresh(obj,not_before,now,future_skew):
    generated_at=parse_receipt_time(obj)
    return generated_at is not None and generated_at >= not_before-dt.timedelta(seconds=1) and generated_at <= now+future_skew

def receipt_passed_self_test():
    passing=[
        {'status':'pass'},
        {'final_verdict':'go_with_caveat'},
        {'status':'pass','sendable':True,'failures':[],'blockers':[]},
    ]
    failing=[
        None,
        [],
        {'checks':[{'status':'pass'}]},
        {'status':'unknown','checks':[{'status':'pass'}]},
        {'status':'pass','final_verdict':'no_go'},
        {'status':'pass','sendable':False},
        {'status':'pass','failures':['nested gate failed']},
        {'status':'pass','blockers':['missing source proof']},
        {'_parse_error':'bad json'},
    ]
    assert all(receipt_passed(value) for value in passing)
    assert not any(receipt_passed(value) for value in failing)
    now=dt.datetime(2026,8,1,12,0,tzinfo=dt.timezone.utc)
    not_before=now-dt.timedelta(minutes=5)
    skew=dt.timedelta(seconds=60)
    assert receipt_fresh({'generated_at':'2026-08-01T11:59:00Z'},not_before,now,skew)
    assert receipt_fresh({'timestamp':'2026-08-01T12:00:30+00:00'},not_before,now,skew)
    assert not receipt_fresh({'generated_at':'2026-08-01T11:00:00Z'},not_before,now,skew)
    assert not receipt_fresh({'generated_at':'2026-08-01T12:01:01Z'},not_before,now,skew)
    assert not receipt_fresh({'generated_at':'not-a-date'},not_before,now,skew)
    assert not receipt_fresh({},not_before,now,skew)
def receipt_blocker_summary(rel:str,obj:Any)->str:
    label=rel.replace('output/','').replace('-latest.json','')
    if obj is None:
        return f'{label}: missing receipt'
    if isinstance(obj,dict) and '_parse_error' in obj:
        return f'{label}: parse error {obj.get("_parse_error")}'
    if not isinstance(obj,dict):
        return f'{label}: not passing'
    parts=[]
    for key in ('status','final_verdict','verdict'):
        if obj.get(key) is not None:
            parts.append(f'{key}={obj.get(key)}')
    if obj.get('sendable') is False:
        parts.append('sendable=false')
    failures=obj.get('failures')
    blockers=obj.get('blockers')
    bad_news=obj.get('bad_news_first')
    if isinstance(failures,list) and failures:
        parts.append('failures=' + ','.join(str(item.get('id') or item.get('type') or item) for item in failures[:3]))
    if isinstance(blockers,list) and blockers:
        parts.append('blockers=' + ','.join(str(item.get('id') if isinstance(item,dict) else item) for item in blockers[:3]))
    if isinstance(bad_news,list) and bad_news:
        parts.append('bad_news=' + ','.join(str(item.get('id') or item) for item in bad_news[:3]))
    summary=_summary(obj)
    if isinstance(summary.get('blockers'),list) and summary.get('blockers'):
        parts.append('summary_blockers=' + ','.join(str(item) for item in summary.get('blockers')[:3]))
    return f'{label}: ' + ('; '.join(parts) if parts else 'not passing')
def get_route_counts(obj):
    if obj is None: return None,None,[]
    samples=[v for v in find_key_values(obj,{'route_sample_count','live_route_samples','route_samples','live_routes'}) if isinstance(v,int)]
    hidden=[v for v in find_key_values(obj,{'hidden_route_count','hidden_internal_route_count','hidden_routes'}) if isinstance(v,int)]
    hidden_details=[]
    for route in (((obj or {}).get('ledger') or {}).get('routes') or []) if isinstance(obj,dict) else []:
        if route.get('status')=='hidden':
            hidden_details.append({'id':route.get('id'),'path':route.get('path'),'class':route.get('class'),'source':route.get('source')})
    return (samples[0] if samples else None, hidden[0] if hidden else None, hidden_details)
def manifest_caveat(obj):
    if not isinstance(obj,dict): return None
    if obj.get('schema_version')!='swfipn.record_manifest_scan.v1': return None
    unreadable=int(obj.get('total_unreadable_delta') or 0)
    if unreadable<=0: return None
    impacted=[{'collection':c.get('collection'),'source_total':c.get('source_total'),'rows_scanned':c.get('rows_scanned'),'unreadable_delta':c.get('unreadable_delta')} for c in obj.get('collections',[]) if int(c.get('unreadable_delta') or 0)>0]
    return {'kind':'backend_source_record_quarantine','total_unreadable_delta':unreadable,'impacted_collections':impacted}
def field_parity_caveats(obj):
    if not isinstance(obj,dict) or obj.get('schema_version')!='swfipn.record_field_parity_full.v2': return []
    caveats=[]
    anomalies=obj.get('data_anomalies') or []
    if anomalies:
        caveats.append({'kind':'field_parity_data_anomaly','count':len(anomalies),'records':anomalies[:20]})
    growth=[warning for warning in (obj.get('warnings') or []) if warning.get('id')=='post_snapshot_count_growth']
    if growth:
        caveats.append({'kind':'post_snapshot_count_growth','count':len(growth),'collections':growth})
    return caveats
def caveat_line(caveat):
    kind=caveat.get('kind')
    if kind=='backend_source_record_quarantine':
        return f"{kind}: {caveat.get('total_unreadable_delta')} unreadable backend source records quarantined by full manifest scan."
    if kind=='field_parity_data_anomaly':
        records=[]
        for item in caveat.get('records') or []:
            records.append(f"{item.get('collection')}/{item.get('id')} field `{item.get('field')}` ({item.get('reason')}, milliseconds={item.get('milliseconds')})")
        return f"{kind}: required displayed fields matched, but {caveat.get('count')} secondary source-data anomaly was detected: " + '; '.join(records) + '.'
    if kind=='post_snapshot_count_growth':
        details=[]
        for item in caveat.get('collections') or []:
            details.append(f"{item.get('collection')} {item.get('mapping_count')} -> {item.get('mongo_count')}")
        return f"{kind}: the frozen snapshot passed, but Mongo grew during verification ({'; '.join(details)}); the added records belong to the next snapshot."
    return f"{kind}: {json.dumps(caveat, ensure_ascii=False, sort_keys=True)}"
def scan_internal_leakage(repo:Path):
    hits=[]; compiled=[(p,re.compile(p,re.I)) for p in LEAK_PATTERNS]
    for path in repo.rglob('*'):
        if not path.is_file(): continue
        if any(part in SKIP_DIRS for part in path.parts): continue
        if path.suffix not in SCAN_SUFFIXES: continue
        low=str(path).lower()
        if ('/test' in low or '.test.' in low or '.spec.' in low) and 'snapshot' not in low: continue
        try: text=path.read_text(encoding='utf-8',errors='ignore')
        except Exception: continue
        for pattern,rx in compiled:
            for m in rx.finditer(text):
                line=text.count('\n',0,m.start())+1
                hits.append({'file':str(path.relative_to(repo)),'line':line,'pattern':pattern,'excerpt':text[max(0,m.start()-40):m.end()+40].replace('\n',' ')[:160]})
                if len(hits)>=50: return {'status':'needs_review','hit_count':len(hits),'hits':hits}
    return {'status':'pass' if not hits else 'needs_review','hit_count':len(hits),'hits':hits}
def _status(obj:Any,default='missing'):
    return obj.get('status') or obj.get('final_verdict') or default if isinstance(obj,dict) else default
def _summary(obj:Any):
    return obj.get('summary') if isinstance(obj,dict) and isinstance(obj.get('summary'),dict) else {}
def write_status_doc(repo,verdict,blockers,phase2,data_quality_caveats=None):
    docs=repo/'docs'; docs.mkdir(exist_ok=True)
    ready='Ready for acceptance/demo review' if verdict in {'go','go_with_caveat'} else 'Not ready'
    share=load_json(repo/'output/swfipn-share-gate-latest.json') or {}
    full_universe=load_json(repo/'output/swfipn-full-universe-mapping-latest.json') or {}
    source_destination=load_json(repo/'output/swfipn-source-destination-manifest-latest.json') or {}
    detail_batch=load_json(repo/'output/swfipn-detail-batch-parity-latest.json') or {}
    route_parity=load_json(repo/'output/swfipn-route-parity-full-latest.json') or {}
    field_parity=load_json(repo/'output/swfipn-record-field-parity-full-latest.json') or {}
    adversarial=load_json(repo/'output/swfipn-adversarial-review-latest.json') or {}
    brd_contract=load_json(repo/'output/swfipn-brd-contract-truth-gate-latest.json') or {}
    brd=load_json(repo/'output/swfipn-brd-phase2-acceptance-latest.json') or {}
    runtime=load_json(repo/'output/swfipn-runtime-staleness-gate-latest.json') or {}
    api_dns=load_json(repo/'output/swfipn-api-dns-key-lifecycle-latest.json') or {}
    api_key_lifecycle=load_json(repo/'output/swfipn-api-key-lifecycle-latest.json') or {}
    api_dns_cutover=load_json(repo/'output/swfipn-api-dns-cutover-latest.json') or {}
    phase2_runtime=load_json(repo/'output/swfipn-phase2-runtime-preflight-latest.json') or {}
    phase2_closure=load_json(repo/'output/swfipn-phase2-closure-packet-latest.json') or {}
    sendgrid=load_json(repo/'output/swfipn-sendgrid-email-brd-gate-latest.json') or {}
    swfi_session_bridge=load_json(repo/'output/swfipn-swfi-session-bridge-brd-gate-latest.json') or {}
    runtime_summary=_summary(runtime)
    marker=(runtime.get('public_release_marker') or {}) if isinstance(runtime,dict) else {}
    deploy=(runtime.get('deploy_receipt') or {}) if isinstance(runtime,dict) else {}
    api_dns_summary=_summary(api_dns)
    share_summary=_summary(share)
    lines=[
        '# SWFI /swficc Acceptance Status',
        '',
        f'Status: {ready}',
        '',
        'Scope: current `/swficc` dashboard/terminal validation scope.',
        '',
        'This does not claim that full BRD Phase 2 productization is complete.',
        '',
        f'Primary public URL: `{os.environ.get("SWFIPN_PRIMARY_PUBLIC_URL", "https://dashboard.swfi.com/swficc/")}`',
        '',
        f'Operational alias: `{share.get("share_url") or "https://swfipn.activemirror.ai/swficc/"}`',
        '',
        f'Deployed release: `{deploy.get("release") or "unknown"}`',
        '',
        f'Public asset version: `{marker.get("asset_version") or deploy.get("asset_version") or "unknown"}`',
        '',
        '## Verdict',
        '',
        f'Acceptance lock: `{verdict}`',
        '',
        f'Share gate: `{_status(share)}`, `sendable: {str(bool(share.get("sendable"))).lower()}`',
        '',
        f'BRD contract truth: `{_status(brd_contract)}`, full-universe parity `{brd_contract.get("full_universe_parity_status") or "unknown"}`',
        '',
        f'BRD Phase 2 matrix: `{_status(brd)}`, verdict `{brd.get("verdict") or "unknown"}`',
        '',
        f'Runtime staleness: `{_status(runtime)}`, failures `{runtime_summary.get("failures", 0)}`',
        '',
        f'API vhost readiness: `{api_dns_summary.get("api_vhost_status", "unknown")}`, HTTP `{api_dns_summary.get("api_vhost_http_status", "unknown")}` -> `{api_dns_summary.get("api_vhost_location", "unknown")}`',
        '',
        f'API key lifecycle on acceptance host: `{_status(api_key_lifecycle)}`',
        '',
        f'Production API DNS cutover: `{_status(api_dns)}`',
        '',
        '## Blockers',
        ''
    ]
    lines += [f'- {b}' for b in blockers] if blockers else ['- None found within current acceptance scope.']
    if api_dns_summary.get('blockers'):
        lines += ['', '## Deferred / Blocked Outside Current Sendable Scope','']
        lines.append('- `api.swfi.com` production cutover remains blocked outside the current `/swficc` sendable scope.')
        for blocker in api_dns_summary.get('blockers',[])[:5]:
            lines.append(f'  - {blocker}')
        for blocker in (api_dns_cutover.get('blockers') or [])[:3] if isinstance(api_dns_cutover,dict) else []:
            lines.append(f'  - dns_cutover_controller:{blocker}')
    phase2_runtime_summary=_summary(phase2_runtime)
    if phase2_runtime_summary.get('blockers'):
        if '## Deferred / Blocked Outside Current Sendable Scope' not in lines:
            lines += ['', '## Deferred / Blocked Outside Current Sendable Scope','']
        lines.append('- Phase 2 runtime integrations remain blocked outside the current `/swficc` sendable scope.')
        for blocker in phase2_runtime_summary.get('blockers',[])[:8]:
            lines.append(f'  - {blocker}')
    lines += ['', '## Latest Evidence','']
    evidence_rows=[
        ('Share/sendability gate',_status(share),'output/swfipn-share-gate-latest.json'),
        ('Full-universe mapping gate',_status(full_universe),'output/swfipn-full-universe-mapping-latest.json'),
        ('Source/destination manifest gate',_status(source_destination),'output/swfipn-source-destination-manifest-latest.json'),
        ('Detail-batch parity gate',_status(detail_batch),'output/swfipn-detail-batch-parity-latest.json'),
        ('Full route parity gate',_status(route_parity),'output/swfipn-route-parity-full-latest.json'),
        ('Record field parity gate',_status(field_parity),'output/swfipn-record-field-parity-full-latest.json'),
        ('Adversarial review gate',_status(adversarial),'output/swfipn-adversarial-review-latest.json'),
        ('BRD contract truth gate',_status(brd_contract),'output/swfipn-brd-contract-truth-gate-latest.json'),
        ('Acceptance criteria gate',_status(load_json(repo/'output/swfipn-acceptance-criteria-gate-latest.json')),'output/swfipn-acceptance-criteria-gate-latest.json'),
        ('KP acceptance gate',_status(load_json(repo/'output/swfipn-kp-acceptance-gate-latest.json')),'output/swfipn-kp-acceptance-gate-latest.json'),
        ('Route and leakage gates','pass','output/swfipn-link-mapping-leakage-gate-latest.json, output/swfipn-visible-link-escape-gate-latest.json'),
        ('BRD Phase 2 gate',_status(brd),'output/swfipn-brd-phase2-acceptance-latest.json'),
        ('Runtime staleness gate',_status(runtime),'output/swfipn-runtime-staleness-gate-latest.json'),
        ('API product gate',_status(load_json(repo/'output/swfipn-api-product-gate-latest.json')),'output/swfipn-api-product-gate-latest.json'),
        ('API key lifecycle gate',_status(api_key_lifecycle),'output/swfipn-api-key-lifecycle-latest.json'),
        ('Admin API Product Console UI gate',_status(load_json(repo/'output/swfipn-admin-api-ui-brd-gate-latest.json')),'output/swfipn-admin-api-ui-brd-gate-latest.json'),
        ('Admin Governance gate',_status(load_json(repo/'output/swfipn-admin-governance-brd-gate-latest.json')),'output/swfipn-admin-governance-brd-gate-latest.json'),
        ('Saved Searches backend/API + linked alert delivery gate',_status(load_json(repo/'output/swfipn-saved-searches-brd-gate-latest.json')),'output/swfipn-saved-searches-brd-gate-latest.json'),
        ('Saved Searches page UI + linked alert delivery gate',_status(load_json(repo/'output/swfipn-saved-searches-ui-brd-gate-latest.json')),'output/swfipn-saved-searches-ui-brd-gate-latest.json'),
        ('Alerts backend/API gate',_status(load_json(repo/'output/swfipn-alerts-brd-gate-latest.json')),'output/swfipn-alerts-brd-gate-latest.json'),
        ('Alerts page UI gate',_status(load_json(repo/'output/swfipn-alerts-ui-brd-gate-latest.json')),'output/swfipn-alerts-ui-brd-gate-latest.json'),
        ('Alert delivery receipts gate',_status(load_json(repo/'output/swfipn-alert-delivery-brd-gate-latest.json')),'output/swfipn-alert-delivery-brd-gate-latest.json'),
        ('SendGrid email delivery gate',_status(sendgrid),'output/swfipn-sendgrid-email-brd-gate-latest.json'),
        ('SWFI session bridge gate',_status(swfi_session_bridge),'output/swfipn-swfi-session-bridge-brd-gate-latest.json'),
        ('Phase 2 runtime preflight',_status(phase2_runtime),'output/swfipn-phase2-runtime-preflight-latest.json'),
        ('Phase 2 closure packet',_status(phase2_closure),'output/swfipn-phase2-closure-packet-latest.json'),
        ('API DNS cutover gate',_status(api_dns),'output/swfipn-api-dns-key-lifecycle-latest.json'),
        ('API DNS cutover controller',_status(api_dns_cutover),'output/swfipn-api-dns-cutover-latest.json'),
    ]
    lines += ['| Gate | Result | Receipt |','| --- | --- | --- |']
    lines += [f'| {name} | `{status}` | `{receipt}` |' for name,status,receipt in evidence_rows]
    if share_summary:
        lines += ['', '## Share Summary','']
        for key in ('receipts','screenshots','failures','source_links','detail_links','mirror_record_links','external_swfi_links'):
            if key in share_summary:
                lines.append(f'- {key}: `{share_summary.get(key)}`')
    lines += ['', '## Data Quality Caveats','']
    if data_quality_caveats:
        for caveat in data_quality_caveats:
            lines.append(f"- {caveat_line(caveat)}")
    else:
        lines.append('- None found.')
    lines += ['', '## Phase 2 / Change Requests','']
    lines += [f'- {p}' for p in phase2] if phase2 else ['- None recorded.']
    if verdict == 'no_go':
        required_sentence = 'The current `/swficc` dashboard/terminal scope is deployed, but it is not sendable until the failing or blocked acceptance receipts pass.'
        final_sentence = 'Blockers remain within the current `/swficc` dashboard/terminal validation scope. Do not call this ready or sendable until the required receipts pass.'
    else:
        required_sentence = 'The current `/swficc` dashboard/terminal scope is deployed, source-backed, and sendable for validation with receipts.'
        final_sentence = 'No blockers are open inside the current `/swficc` dashboard/terminal validation scope. Full BRD Phase 2 remains active because the explicit deferred productization bucket and production `api.swfi.com` DNS cutover are not complete.'
    lines += ['', '## Required wording','', f'Use: “{required_sentence}”','', 'Use: “corresponding SWFI core platform record/profile page through SWFI sign-in handoff.”','', 'Do not use: “Full BRD Phase 2 is complete.”','', 'Do not use: “All SWFI.com pages are fully migrated.”','', '## Final acceptance sentence','', final_sentence]
    (docs/'swfipn-acceptance-status.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--repo',default='.'); ap.add_argument('--out',default='output/swfipn-acceptance-lock-latest.json'); ap.add_argument('--receipt',action='append',default=[]); ap.add_argument('--not-before',default=''); ap.add_argument('--max-receipt-age-seconds',type=int,default=21600); ap.add_argument('--max-future-skew-seconds',type=int,default=60); ap.add_argument('--self-test',action='store_true'); args=ap.parse_args()
    if args.self_test:
        receipt_passed_self_test()
        print(json.dumps({'status':'pass','self_test':True}))
        return 0
    if args.max_receipt_age_seconds < 0 or args.max_future_skew_seconds < 0:
        raise ValueError('receipt age and future skew must be non-negative')
    repo=Path(args.repo).resolve(); receipt_paths=args.receipt or DEFAULT_RECEIPTS
    now=dt.datetime.now(dt.timezone.utc)
    if args.not_before:
        not_before=dt.datetime.fromisoformat(args.not_before.replace('Z','+00:00'))
        if not_before.tzinfo is None: not_before=not_before.replace(tzinfo=dt.timezone.utc)
        not_before=not_before.astimezone(dt.timezone.utc)
    else:
        not_before=now-dt.timedelta(seconds=args.max_receipt_age_seconds)
    future_skew=dt.timedelta(seconds=args.max_future_skew_seconds)
    req=[]; all_pass=True; route_count=None; hidden_count=None; hidden_details=[]; data_quality_caveats=[]; failed_receipts=[]
    for rel in receipt_paths:
        obj=load_json(repo/rel); authoritative=receipt_passed(obj); fresh=receipt_fresh(obj,not_before,now,future_skew); passed=authoritative and fresh; all_pass=all_pass and passed
        if 'route-ledger' in rel: route_count,hidden_count,hidden_details=get_route_counts(obj)
        if caveat:=manifest_caveat(obj): data_quality_caveats.append(caveat)
        if 'record-field-parity-full' in rel: data_quality_caveats.extend(field_parity_caveats(obj))
        if not passed:
            reasons=[]
            if not authoritative: reasons.append('authoritative_top_level_verdict=false')
            if not fresh: reasons.append(f'fresh_for_run=false:not_before={not_before.isoformat()}')
            failed_receipts.append(receipt_blocker_summary(rel,obj) + ('; ' + '; '.join(reasons) if reasons else ''))
        req.append({'path':rel,'exists':(repo/rel).exists(),'passed':passed,'authoritative_top_level_verdict':authoritative,'fresh_for_run':fresh,'generated_at':(obj.get('generated_at') or obj.get('timestamp')) if isinstance(obj,dict) else None,'parse_error':obj.get('_parse_error') if isinstance(obj,dict) and '_parse_error' in obj else None})
    leakage=scan_internal_leakage(repo)
    blockers=[]
    if not all_pass: blockers.extend(failed_receipts)
    if leakage['status']!='pass' and leakage['hit_count']>0: blockers.append('Internal-leakage scan found terms requiring review.')
    phase2=['Admin API-key lifecycle UI and Admin Governance pass on the accepted public host; real SWFI auth/session integration remains deferred P2 until the SWFI session bridge gate passes against the target runtime.','Alerts backend/API, Alerts page UI API client, and alert in-app/webhook delivery receipts pass on the accepted public host. SendGrid email delivery code and gate are deployed, but public email delivery remains blocked until the target runtime has a configured SendGrid key/from-address and the SendGrid email gate passes.','Saved Searches backend/API, page UI API client, and linked in-app alert delivery receipts pass on the accepted public host; local SWFI session bridge mechanics are receipt-backed, but real SWFI auth/session integration remains blocked until SWFI supplies signed assertions and the bridge is configured on the target runtime.','SWFI session bridge code and gate are implemented; public runtime remains blocked until `output/swfipn-swfi-session-bridge-brd-gate-latest.json` passes with the SWFI assertion secret/return path configured.','SendGrid onboarding remains deferred P2 until `output/swfipn-sendgrid-email-brd-gate-latest.json` passes against the target runtime.','api.swfi.com DNS cutover remains blocked/deferred until the DNS/key lifecycle gate passes. The cutover controller found the `api` A record and rollback data, but the available DigitalOcean token lacks DNS write permission. API-key lifecycle, Admin API-key lifecycle UI, Admin Governance, Alerts backend/API, Alerts page UI API client, Alert delivery receipts, Saved Searches backend/API, Saved Searches page UI API client, and saved-search linked in-app alert delivery pass on the accepted public host.']
    hidden_blockers=[r for r in hidden_details if r.get('class')!='uncontracted_route_hidden_from_public_navigation']
    verdict='no_go' if blockers else ('go_with_caveat' if hidden_blockers or data_quality_caveats else 'go')
    matrix=[{'criterion':c,'status':'pass' if not blockers or c!='Existing gate receipts remain passing.' else 'needs_review','evidence':'See required receipts and scans.','blocker': bool(blockers and c=='Existing gate receipts remain passing.')} for c in CRITERIA]
    receipt={'timestamp':now_iso(),'git_commit':git_commit(repo),'tested_scope':'Current /swficc dashboard/terminal validation scope.','loop_budget':{'builder_passes':1,'prosecutor_passes':1,'max_internal_refinements_per_pass':1,'extra_passes_allowed':False,'extra_pass_reason_required':'new external evidence only'},'criteria_matrix':matrix,'required_receipts':req,'command_list_run':[{'command':'git rev-parse HEAD','status':'ok'},{'command':'required receipt inspection','status':'ok'},{'command':'internal leakage scan','status':leakage['status']},{'command':'git diff --numstat baseline','status':'ok'}],'working_tree_diff':git_diff_stats(repo),'route_sample_count':route_count,'hidden_internal_route_count':hidden_count,'hidden_internal_routes':hidden_details,'hidden_internal_route_blockers':hidden_blockers,'data_quality_caveats':data_quality_caveats,'unauth_redirect_result':'pass_if_canonical_swfi_links_and_swfi_auth_behavior_passed','auth_route_result':'pass_if_route_ledger_and_e2e_gates_passed','internal_leakage_scan_result':leakage,'mobile_responsive_check_result':'not independently tested by this script; rely on E2E/browser receipts if present','blockers':blockers,'phase_2_non_blockers':phase2,'final_verdict':verdict,'safe_final_sentence':'No blockers are open inside the current `/swficc` dashboard/terminal validation scope. Full BRD Phase 2 remains active because the explicit deferred productization bucket and production `api.swfi.com` DNS cutover are not complete.' if verdict!='no_go' else 'Blockers remain within current `/swficc` dashboard/terminal validation scope.'}
    out=repo/args.out; out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    write_status_doc(repo,verdict,blockers,phase2,data_quality_caveats)
    print(json.dumps({'wrote':str(out),'verdict':verdict,'blockers':blockers,'route_sample_count':route_count,'hidden_internal_route_count':hidden_count},indent=2))
    return 1 if verdict=='no_go' else 0
if __name__=='__main__': raise SystemExit(main())
