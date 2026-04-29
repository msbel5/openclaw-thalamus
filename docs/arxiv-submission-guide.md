# arXiv submission guide — The Thalamus Layer

## Files

```
arxiv_preprint/
├── thalamus-layer.tex      # full LaTeX source, self-contained
├── SUBMISSION.md           # this file
└── (build outputs)
    ├── thalamus-layer.pdf
    ├── thalamus-layer.log
    └── thalamus-layer.aux
```

## Build the PDF locally

On the Pi (TeX Live should already be installed; if not, `sudo apt install texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended`):

```bash
cd ~/alcyone-arxiv
pdflatex thalamus-layer.tex
pdflatex thalamus-layer.tex   # second pass for cross-refs
```

This produces `thalamus-layer.pdf`. Review it visually before submitting.

## arXiv account + endorsement

If this is your first arXiv submission in cs.AI / cs.LG / cs.MA categories:

1. Create an account at https://arxiv.org/login (use msbel5@gmail.com).
2. arXiv will ask for institutional affiliation — "Independent Researcher" is fine.
3. **Endorsement check.** Submission to cs.AI usually needs an endorser
   (a previous arXiv author in that category who vouches for you). You
   can request one at https://arxiv.org/auth/need-endorsement.
4. **Alternative: post to a category where you have prior work.** If your
   earlier engineering papers (cement, linear motors, predictive maintenance)
   are on arXiv in eess.SY, eess.SP, or cs.SY, you may auto-qualify for
   cross-listing into cs.MA without external endorsement.

If you do not have prior arXiv submissions, the smoothest path is:

- Email an endorser request to one of the LatentMAS or HippoRAG authors,
  attaching a short paragraph and a link to the GitHub repo of the work.
  Most academic authors endorse new researchers if the work looks honest.
- Or post first to **cs.MA (Multi-Agent Systems)**, which typically has a
  lower endorsement bar than cs.AI.

## Submission steps (web UI)

1. Login at https://arxiv.org/.
2. **Start New Submission**.
3. **License**: choose **CC BY 4.0** (allows reuse with attribution) or
   **CC BY-SA 4.0** (share-alike). Both compatible with the MIT license
   on the code.
4. **Article class**: LaTeX (auto-detected from `.tex` file).
5. **Upload** `thalamus-layer.tex` only. arXiv compiles it server-side,
   so no need to upload the PDF.
6. **Title**: `The Thalamus Layer: Native Vector Routing for Edge AI Agents`
7. **Authors**: `Muhammet Sıddık Bel`
8. **Abstract**: copy from the LaTeX `\begin{abstract}...\end{abstract}` block.
9. **Primary category**: `cs.MA` (Multi-Agent Systems).
   **Cross-list to**: `cs.AI`, `cs.LG`.
10. **Comments**: short note like `Reference implementation as
    OpenClaw plugin: https://github.com/msbel5/openclaw-thalamus.
    Companion plugins: openclaw-aegis-signer, openclaw-sga-mcts-atoms.
    13 pages, 1 figure (ASCII).`
11. **DOI**: leave blank.
12. **MSC class / ACM class**: skip.
13. Submit. arXiv will compile it. If the build succeeds, you get a
    submission ID and an embargo until the next announcement window
    (usually 13:00 UTC weekdays, 13:00 UTC Sunday for Monday).

## What happens after submission

- arXiv compiles your `.tex`. If the build fails, you get an email with
  the log. Fix locally with `pdflatex` and resubmit.
- Once accepted, the preprint goes live at
  `https://arxiv.org/abs/26XX.YYYYY`.
- Citation count starts. Indexing in Google Scholar happens within a
  few days.

## Including your older papers

If you want to also archive the older engineering papers (cement,
linear motors, predictive maintenance for electric motors) on arXiv:

1. Check whether they were published in journals with copyright
   restrictions. If so, you may post the **author's accepted manuscript**
   (post-print) but not the **publisher's PDF**.
2. Create separate arXiv submissions for each, in `eess.SY`
   (Electrical Engineering, Systems and Control) or `eess.SP`
   (Signal Processing).
3. They are not blockers for the thalamus paper; they would establish
   you as a multi-domain author and strengthen the thalamus
   submission's credibility, but the thalamus submission can go first.

## Cross-publishing

After arXiv goes live:

- Add the arXiv ID to the GitHub README of `openclaw-thalamus`.
- Add to `msbel.com` blog post as the canonical academic record.
- Tweet / Bluesky / HN with the arXiv link as the primary citation.
- Update LinkedIn / ResearchGate if you use those.

## Priority claim

The arXiv timestamp + the GitHub commit timestamps + the npm publish
timestamps together form a forensic-grade record of priority. If
parts of the architecture later appear in larger systems, the order
of public artifacts is verifiable.

The work is also covered by the npm and GitHub publish dates of the
companion plugins (`@msbel/openclaw-aegis-signer` and
`@msbel/openclaw-sga-mcts-atoms`), which were published on
2026-04-29 before this paper.
