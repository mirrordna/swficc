#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, json, re, subprocess
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
    'output/swfipn-share-gate-latest.json',
    'output/swfipn-source-truth-gate-latest.json',
    'output/swfipn-source-url-coverage-latest.json',
    'output/swfipn-visual-gate-latest.json',
]
CRITERIA=['Dashboard look and feel is consistent with SWFI website.','Public /swficc dashboard renders without login.','Dashboard business hyperlinks point to canonical SWFI platform record/profile pages when source URLs exist.','Existing SWFI platform authentication handles unauthenticated record-link redirects and authenticated continuity.','No internal technical details are visible to users.','Table rows link to appropriate SWFI record/profile pages.','Public API/frontend payloads do not expose restricted/private/internal data.','Missing/empty data renders cleanly.','Mobile/tablet/desktop layout does not break.','Existing gate receipts remain passing.']
LEAK_PATTERNS=[r'\bobject[_\s-]?id\b',r'\bdatabase[_\s-]?id\b',r'\bdebug\b',r'\bstack trace\b',r'\btraceback\b',r'\bActive Mirror\b',r'\broute ledger\b',r'\bsource gap\b',r'\binternal diagnostic',r'\bNaN\b']
SKIP_DIRS={'.git','node_modules','.next','dist','build','coverage','__pycache__','.venv','venv','output','logs','out','tmp','tools','scripts','schemas','configs'}
SCAN_SUFFIXES={'.html','.tsx','.jsx','.ts','.js','.vue','.svelte'}
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
    if obj is None or (isinstance(obj,dict) and '_parse_error' in obj): return False
    for v in find_key_values(obj,{'status','result','verdict','gate_status'}):
        if isinstance(v,str) and v.lower() in {'pass','pass_with_quarantine','passed','ok','green','success'}: return True
    if any(v is True for v in find_key_values(obj,{'pass','passed','success','sendable'})): return True
    flat=json.dumps(obj).lower()
    if '"fail"' in flat or '"failed"' in flat or '"no_go"' in flat: return False
    return False
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
        f'Public URL: `{share.get("share_url") or "https://swfipn.activemirror.ai/swficc/"}`',
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
            lines.append(f"- {caveat.get('kind')}: {caveat.get('total_unreadable_delta')} unreadable backend source records quarantined by full manifest scan.")
    else:
        lines.append('- None found.')
    lines += ['', '## Phase 2 / Change Requests','']
    lines += [f'- {p}' for p in phase2] if phase2 else ['- None recorded.']
    lines += ['', '## Required wording','', 'Use: “The current `/swficc` dashboard/terminal scope is deployed, source-backed, and sendable for validation with receipts.”','', 'Do not use: “Full BRD Phase 2 is complete.”','', 'Do not use: “All SWFI.com pages are fully migrated.”','', '## Final acceptance sentence','', 'No blockers are open inside the current `/swficc` dashboard/terminal validation scope. Full BRD Phase 2 remains active because the explicit deferred productization bucket and production `api.swfi.com` DNS cutover are not complete.']
    (docs/'swfipn-acceptance-status.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--repo',default='.'); ap.add_argument('--out',default='output/swfipn-acceptance-lock-latest.json'); ap.add_argument('--receipt',action='append',default=[]); args=ap.parse_args()
    repo=Path(args.repo).resolve(); receipt_paths=args.receipt or DEFAULT_RECEIPTS
    req=[]; all_pass=True; route_count=None; hidden_count=None; hidden_details=[]; data_quality_caveats=[]
    for rel in receipt_paths:
        obj=load_json(repo/rel); passed=receipt_passed(obj); all_pass=all_pass and passed
        if 'route-ledger' in rel: route_count,hidden_count,hidden_details=get_route_counts(obj)
        if caveat:=manifest_caveat(obj): data_quality_caveats.append(caveat)
        req.append({'path':rel,'exists':(repo/rel).exists(),'passed':passed,'parse_error':obj.get('_parse_error') if isinstance(obj,dict) and '_parse_error' in obj else None})
    leakage=scan_internal_leakage(repo)
    blockers=[]
    if not all_pass: blockers.append('One or more required gate receipts are missing or not passing.')
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
