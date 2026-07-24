#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, json, subprocess
from pathlib import Path
def now_iso(): return dt.datetime.now(dt.timezone.utc).isoformat()
def run(repo,cmd,timeout=20):
    try:
        cp=subprocess.run(cmd,cwd=repo,text=True,capture_output=True,timeout=timeout)
        return cp.returncode,(cp.stdout+cp.stderr).strip()
    except Exception as e: return 999,str(e)
def git_commit(repo):
    code,out=run(repo,['git','rev-parse','HEAD']); return out.strip() if code==0 else 'unknown'
def git_diff_stats(repo):
    code,out=run(repo,['git','diff','--numstat']); files=[]; added=0; deleted=0
    if code==0 and out:
        for line in out.splitlines():
            parts=line.split('\t')
            if len(parts)>=3:
                try: ai=int(parts[0])
                except ValueError: ai=0
                try: di=int(parts[1])
                except ValueError: di=0
                added+=ai; deleted+=di; files.append({'file':parts[2],'added':ai,'deleted':di})
    return {'changed_files':files,'total_added':added,'total_deleted':deleted}
def load_json(p):
    try: return json.loads(p.read_text(encoding='utf-8'))
    except Exception: return None
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--repo',default='.'); ap.add_argument('--out',default='output/swfipn-loop-collapse-latest.json'); ap.add_argument('--acceptance-lock',default='output/swfipn-acceptance-lock-latest.json'); args=ap.parse_args()
    repo=Path(args.repo).resolve(); diff=git_diff_stats(repo); lock=load_json(repo/args.acceptance_lock) or {}
    gates_pass=lock.get('final_verdict') in {'go','go_with_caveat'}; blockers=lock.get('blockers',[])
    baseline=lock.get('working_tree_diff') if isinstance(lock.get('working_tree_diff'),dict) else {}
    baseline_files={item.get('file') for item in baseline.get('changed_files',[]) if isinstance(item,dict)}
    current_files={item.get('file') for item in diff['changed_files']}
    added_delta=max(0,diff['total_added']-int(baseline.get('total_added',0) or 0))
    deleted_delta=max(0,diff['total_deleted']-int(baseline.get('total_deleted',0) or 0))
    changed_file_delta=len(current_files-baseline_files) if baseline_files else len(diff['changed_files'])
    churn_without_blocker=gates_pass and not blockers and (added_delta+deleted_delta>250)
    excessive_files=gates_pass and not blockers and changed_file_delta>20
    signals={'acceptance_lock_verdict':lock.get('final_verdict','missing'),'blocker_count':len(blockers),'changed_file_count':len(diff['changed_files']),'changed_file_delta_after_lock':changed_file_delta,'total_added_lines':diff['total_added'],'total_deleted_lines':diff['total_deleted'],'added_line_delta_after_lock':added_delta,'deleted_line_delta_after_lock':deleted_delta,'churn_without_blocker':churn_without_blocker,'excessive_files_changed_after_pass':excessive_files,'same_issue_renamed_not_detectable_by_script':'manual_review_required','confidence_language_replacing_receipts':'manual_review_required'}
    collapse=bool(churn_without_blocker or excessive_files)
    if collapse: rec='Freeze further self-loops. Require new external evidence before additional changes.'
    elif gates_pass: rec='No loop collapse detected by automated checks. Freeze and use acceptance-lock wording.'
    else: rec='Acceptance is not locked. Fix blockers, rerun gates, then rerun collapse detector.'
    report={'timestamp':now_iso(),'git_commit':git_commit(repo),'collapse_detected':collapse,'signals':signals,'recommendation':rec,'changed_files':diff['changed_files'][:100]}
    out=repo/args.out; out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({'wrote':str(out),'collapse_detected':collapse,'recommendation':rec},indent=2))
    return 2 if collapse else 0
if __name__=='__main__': raise SystemExit(main())
