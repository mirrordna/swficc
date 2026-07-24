.PHONY: swficc-acceptance-lock loop-collapse

swficc-acceptance-lock:
	python3 tools/loop-budget/swficc_acceptance_lock.py --repo . --out output/swfipn-acceptance-lock-latest.json

loop-collapse:
	python3 tools/loop-budget/loop_collapse_detector.py --repo . --out output/swfipn-loop-collapse-latest.json
