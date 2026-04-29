---
title: "The Thalamus Layer"
subtitle: "Why agents should stop talking through text. A proposal for native vector routing, hippocampal memory, and idle replay in edge AI agents."
author: Muhammet Sıddık Bel (msbel5)
date: 2026-04-29
tags: [ai, agents, openclaw, alcyone, architecture, edge]
---

# The Thalamus Layer

Six weeks ago I tried to build twenty-five agents. Most of them never ran.
Last week I rebuilt the system around five. The lesson was not that twenty-five
was too many. The lesson was that all twenty-five were doing the same thing.
They were turning thoughts into sentences, sending the sentences across a wire,
and reading them back as thoughts on the other side.

Every agent in my system was doing this. Every agent in every published
multi-agent framework I have looked at was doing this. The vision model takes
an image, encodes it into a 768-dim vector, generates a caption, and hands the
caption to the planning model. The planning model reads the caption, embeds
it back into a 4096-dim hidden state, plans, and writes a sentence for the
critic. The critic reads the sentence, embeds it, decides, writes a verdict.
By the time anything has been "done", the same idea has been encoded into
vector space and decoded back into English five or six times.

Each round trip is lossy. Each round trip costs tokens. Each round trip
serializes through a substrate that was never meant to be the substrate.

This post is about a different way to build it.

## The bottleneck nobody is shouting about

Modern AI agents inherit a strange contract from the chat era. The contract
says: the canonical interchange format between intelligent components is
human language. Models talk to each other in English. Tools talk to each
other in JSON, but the JSON wraps English. Memory stores English so it can
be re-embedded later. Plans are English. Critiques are English.

This contract is fine when the only consumer is a human. It is wasteful
and lossy when the only consumer is another model.

A simple example. A vision encoder takes a picture of a leaking pipe and
produces a 1024-dim embedding. The embedding contains rich information
about texture, shape, color gradient, the angle of the leak, the suspected
material. To pass this information to the planning model, current systems
make the vision model write a caption: `"a corroded pipe with visible water
leak under a bathroom sink"`. The caption is then re-embedded by the
planner. Most of the texture and gradient information is gone. The caption
won't tell you whether the corrosion is rust or biofilm. The original
embedding could.

We are running multimodal models the way you would run two specialists
who both speak fluent French but who have agreed, by some old convention,
to communicate only via Morse code in English.

## A small live experiment

I asked Claude Sonnet 4.6 to interpret three real embeddings I generated
on my Raspberry Pi this morning. Each was a `text-embedding-3-small`
vector, 1536 dimensions, L2-normalized. I gave Claude the model name, the
dimension count, the first 20 floats, and basic statistics for each. I did
not tell it what the sentences said.

Claude's reply, verbatim, edited only for length:

> I can tell you, from these numbers, the model: dimensionality 1536 plus
> normalization pattern fingerprints OpenAI text-embedding-3-small. I can
> tell you the statistical health is good, no NaN, no degenerate values.
> Probable similarity between sentences 1 and 3 looks higher than between
> 2 and either, because the L2-normalized cosine of the first 20 floats
> already shows partial alignment.
>
> I cannot tell you what any of the three sentences actually said. I
> cannot tell you which sentence is sentence 1 versus sentence 2 versus
> sentence 3. I cannot tell you what any individual dimension means
> semantically. I cannot respond to the meaning of any of these inputs.
>
> This is the bottleneck. I was trained on text and images. I was not
> trained on raw embeddings. They are not my native input. The information
> is there. I can prove it is there statistically. But the information is
> unreadable to me without a text decoder pass.

Two things here. First, the model is honest about its own architecture
limit. Second, this is exactly the failure mode the multi-agent literature
keeps stepping over. We have all the information at the encoder. We throw
most of it away to fit through the text channel. Then we wonder why
agents are slow and forgetful.

## What the brain actually does, as engineering

I want to use brain words but I want to use them as engineering, not as
metaphor. Here is the mapping I am working with.

**Specialist cortex** is the part of the brain that does one job well.
The visual cortex segments and classifies. The auditory cortex tracks
pitch, rhythm, spatial origin of sound. The motor cortex produces fine
movement plans. None of these areas read English. They produce activation
patterns. Other areas consume those activation patterns directly. In an
agent system the specialists are the encoders. SigLIP, DINOv2, Whisper,
EnCodec, e5-small. Each produces a vector. Each is good at one modality.

**Thalamus** is a relay and a router. It is not the smart part of the
brain. It does not reason. It decides which sensory channel goes to which
cortical area, with what gating, at what attentional weight. In an agent
system the thalamus is software. A loop that holds vector packets, knows
which module asked for what, and forwards the right packets to the right
consumer. It also gates. When the system is overwhelmed, the thalamus
decides what gets dropped.

**Hippocampus** is not the main memory. It is the index that sits between
short-term and long-term memory. It tags experiences for later retrieval.
It supports replay. In an agent system the hippocampus is a layered store.
A hot tier in Redis for working memory. A vector index for semantic
recall. A markdown vault, which is to say Obsidian, for narrative episodic
storage. And a raw embedding cache for modality-preserving recall, which
most current systems do not have at all.

**Default Mode Network** is the network that activates when the brain is
not externally focused. People used to call it the resting state and
assume it was idle. It is not idle. It runs simulations. It rehearses
yesterday. It plans tomorrow. It builds the self-model. In an agent
system the DMN is an idle loop. When the user is not asking anything, the
agent runs replay. It pulls embedding packets from the hippocampus,
re-feeds them through reasoning cores, looks for contradictions, builds
new associations, writes new index entries. This is consolidation. It is
the work that gets done while you sleep.

I am not claiming any of this is consciousness. I am claiming this is
engineering that actually works. The brain does it. We can copy the
shape.

## The architecture

```
                          User input
                              |
                              v
   +---------------------------------------------------------+
   |             specialist encoders                         |
   |   (SigLIP, DINOv2, Whisper, EnCodec, e5-small, ...)     |
   +-----------------------------+---------------------------+
                                 |  raw embeddings, per modality
                                 v
   +---------------------------------------------------------+
   |             modality adapters                           |
   |   (small linear or MLP heads, trained or frozen,        |
   |    project each modality into the shared workspace)     |
   +-----------------------------+---------------------------+
                                 |  shared-workspace vectors
                                 v
   +---------------------------------------------------------+
   |             thalamus router                             |
   |   in-process loop, holds packets, gates, schedules,     |
   |   decides who needs what, when, at what priority        |
   +-----+-----------------+-----------------+---------------+
         |                 |                 |
         v                 v                 v
   +-----+----+       +----+-----+      +----+-----+
   | reasoning|       | critic   |      | planner  |
   |   core   |       |   core   |      |   core   |
   +----+-----+       +----+-----+      +----+-----+
        |                  |                  |
        +-------+----------+--------+---------+
                |                   |
                v                   v
   +---------------------------------------------------------+
   |             hippocampal memory                          |
   |   Redis hot       |  vector DB   |  Obsidian episodic   |
   |   raw-embedding cache (modality-preserving recall)      |
   +-----------------------------+---------------------------+
                                 |  recall, replay, write-back
                                 |
                          (DMN replay loop)
                                 |
                                 v
                    Language head only at the very end,
                  for the single message back to the user.
```

The language head sits at the bottom on purpose. It is the output device.
It is not the substrate.

This shape is not new in the literature. Perceiver IO from 2021 already
showed that you can route arbitrary modalities through a general latent
processor. V-JEPA from Meta is doing video prediction in latent space
rather than in pixels for the same reason. LatentMAS, published late
last year, proposes exactly this kind of latent-space collaboration
between agents. HippoRAG from NeurIPS 2024 implements the hippocampal
indexing role for retrieval. None of these are deployed end-to-end in
a single small agent runtime. That is the gap I am trying to close.

## Where Alcyone is today, and what is still pretend

Alcyone is my personal AI agent. It runs on a Raspberry Pi 5 with 4 GB
of RAM. The runtime is OpenClaw 2026.4.26. The deployment is six weeks
old. Some of what I described above is built. Some is half built. Some
is roadmap. I want to be honest about which is which, because the value
of this writeup is in the gap between what we have and what is missing.

What is built and live:
- Five-agent crew with real delegation. Liaison, Captain, Builder,
  Inspector, Archivist. Each has its own model and its own session
  context. Captain spawns Builder via `sessions_spawn`. The chain works.
- Four-layer memory. Hot tier in `claude-mem` SQLite with FTS5 search.
  Semantic markdown vault via `memory-wiki`. Vector store via
  `memory-lancedb`. Pre-reply injection via `active-memory`. This is
  three of the four hippocampus layers I described above.
- AEGIS Ed25519-signed tool-call audit. Every tool call writes a signed,
  hash-chained entry to `audit-log.jsonl`. Inspector verifies the chain
  before approving any agent claim. This is the only fix I know of for
  the "MISSION ACCOMPLISHED without proof" pattern. Open source as
  `@msbel/openclaw-aegis-signer`.
- SGA-MCTS atom retrieval. Every Inspector-approved session is auto
  extracted into a vector store as a reusable tool-use atom. Captain
  queries this store at plan time before decomposing new tasks. Open
  source as `@msbel/openclaw-sga-mcts-atoms`.
- Heartbeat. The agent ticks every forty-five minutes during active
  hours. The tick rotates through a 16-slot schedule that includes
  arxiv sweeps, github trending checks, codebase smoke tests, identity
  drift detection, and budget audits.
- Cloudflare tunnel exposing `alcyone.msbel.com` (PWA control panel)
  and `trading.msbel.com` (gated behind Cloudflare Access).

What is missing, and is the subject of this proposal:
- Native vector routing. Right now agents serialize through text. The
  thalamus does not exist. This is the next thing to build.
- Specialist encoders running locally. We have OpenAI text-embedding
  for the lancedb side, but no SigLIP, no Whisper encoder feeding the
  agent, no EnCodec. The Pi can run small versions of these.
- Modality adapters. The hardest part. Each encoder produces a
  different shaped vector in a different space. Aligning them into
  a shared workspace is real work.
- Raw-embedding cache. The fourth memory layer. Right now we recall
  via re-encoding text, which loses modality fidelity. The cache
  preserves the original embedding alongside the text artifact.
- DMN replay loop. The heartbeat exists. It does not yet pull random
  past embeddings, re-feed them through reasoning, and write new
  associations. That is what makes idle time productive.

I list these so you do not read this post and assume I have shipped
all of it. I have not. I have shipped the bones. The interesting part
is what comes next.

## The roadmap

**Phase 1, software simulation, in-process.** Single Python process.
All specialist encoders loaded as modules. All adapters as small linear
or MLP heads. Thalamus is a router class. Tensor exchange via numpy
arrays in shared memory. Memory layers as already deployed. DMN loop
as a heartbeat slot. This is what I can build in a few weekends on
the Pi I already have.

**Phase 2, distributed, multi-process.** Encoders, reasoning cores,
and memory each run as separate processes. Thalamus runs in its own
process and addresses peers via shared memory or RDMA-style local
transport. No text on the bus. JSON metadata only, with binary tensor
payloads transmitted out of band. This is harder but still software.
It probably needs a 4 GB Pi to be 8 GB or a small cluster of Pis.

**Phase 3, hardware thalamus.** A dedicated routing fabric. Probably
an FPGA card, possibly a Hailo-class NPU as a thalamus accelerator,
eventually an ASIC. The job of this hardware is to move tensors
between modules with predictable latency and gating semantics. This
is more than a year out and probably needs collaborators who care
about the same thing. I am writing this post partly to find them.

I keep Phase 3 on the roadmap because it lets the system scale beyond
what software alone can do. But everything before Phase 3 is doable
on commodity hardware today.

## Why edge, and why open source

The labs that can afford to research this at scale are doing it on
clusters. DeepMind, Meta FAIR, Anthropic, Sakana, Adept. They publish.
Their code does not always ship. When it ships, it ships at cluster
scale. A normal person cannot run it on their machine.

I think there is room for a parallel program. A small, open, replicable
runtime that runs on hardware a hobbyist can own. Pi 5 today. Pi 6 or
8 GB Pi 5 next year. AI HAT+ for accelerated inference. The whole
thing under MIT license, every plugin pinned to npm, every pull request
welcome. Not because edge can outpace cluster for raw capability, but
because edge can teach a different lesson: how small does an honest
agent need to be?

The two plugins I have already published are part of this program.
`@msbel/openclaw-aegis-signer` is the audit layer. `@msbel/openclaw-sga-mcts-atoms`
is the atom retrieval layer. The next plugin is the thalamus, and the
PRD for it is in the same repo.

## Related work

- HippoRAG, NeurIPS 2024. Neurobiologically inspired long-term memory
  using a knowledge graph + Personalized PageRank as the artificial
  hippocampus. Closest existing work to the memory layer of this proposal.
  https://arxiv.org/abs/2405.14831
- Theater of Mind / Global Workspace Agents, April 2026. A central
  broadcast hub plus heterogeneous functionally-constrained agents.
  Closest existing work to the thalamus + cortex split.
  https://arxiv.org/abs/2604.08206
- LatentMAS, late 2025. Multi-agent collaboration directly in latent
  space rather than via text. Confirms that the bottleneck described
  in this post is recognized in the literature.
  https://arxiv.org/abs/2511.20639
- V-JEPA, 2024. Latent video prediction without pixel reconstruction.
  Argues for prediction in representation space. Strong endorsement of
  "do not decode just to encode again" as a principle.
  https://openreview.net/forum?id=WFYbBOEOtv
- Perceiver IO, 2021. General latent processor for arbitrary modality
  inputs and outputs. The architectural ancestor of much of what is
  described here.
  https://arxiv.org/abs/2107.14795
- Bicameral Labs, started 2025 by Erik Hoel. Active research initiative
  on consciousness. Their first paper is a disproof of LLM consciousness,
  which is honest and useful.

## What is next

I will build Phase 1 in the open. The thalamus plugin will live at
`github.com/msbel5/openclaw-thalamus` once it has more than a PRD.
Voice in via Whisper.cpp and voice out via Piper are already installed
on the Pi, waiting for the modality adapter that lets them feed the
thalamus instead of feeding a text stub. Memory layer four, the raw
embedding cache, is a small extension to the existing `memory-lancedb`
plugin. None of this requires a million dollars. It requires a few
weekends and a Raspberry Pi that does not crash when the trading bot
retrains itself at three in the morning.

If you are reading this and you are working on the same shape of
problem, please email me. If you are reading this and you think the
shape is wrong, please email me. The address is on the about page.

## A note on priority

This post is the first public statement of this proposal. It is
timestamped on the date in the header. The two supporting plugins
are already on npm and on GitHub with their own publish dates. The
arXiv preprint of the same proposal will go up shortly after this
post. None of these claims are dependent on hidden text or invisible
watermarks. They live on public timelines.

If parts of the architecture later show up in larger systems, that
is fine. I am not trying to corner an idea. I am trying to make a
small piece of it run on hardware I can hold in my hand, in a way
that someone else can replicate.

The first time I saw a personal computer I was seven. I stood in
front of it for an hour and did not touch the keyboard. I did not
know what to ask. I think this is the same posture, three decades
later. The asking takes the longest. The building, once you know
what to ask for, is fast.

---

## References and links

- AEGIS plugin (npm): https://www.npmjs.com/package/@msbel/openclaw-aegis-signer
- AEGIS plugin (GitHub): https://github.com/msbel5/openclaw-aegis-signer
- SGA-MCTS plugin (npm): https://www.npmjs.com/package/@msbel/openclaw-sga-mcts-atoms
- SGA-MCTS plugin (GitHub): https://github.com/msbel5/openclaw-sga-mcts-atoms
- Alcyone control panel (token-protected): https://alcyone.msbel.com
- Author: Muhammet Sıddık Bel, msbel5@gmail.com, https://msbel.com

## Appendix A. The vector probe transcript

Sentences embedded with `text-embedding-3-small` on a Raspberry Pi 5,
April 29 2026:

```
1. The first time I saw Back to the Future, I decided to become a scientist.
2. Alcyone is a personal AI agent running on a Raspberry Pi 5.
3. Multi-agent systems lose information when they serialize through text.
```

First 20 floats of each, full L2-normalized to magnitude 1.0:

```
S1: -0.003462 -0.008987 -0.097595 +0.017899 -0.013527 -0.015549
    +0.033905 +0.009499 -0.014252 -0.015480 +0.013382 +0.022766
    -0.021164 -0.007301 -0.000377 +0.024368 -0.025604 -0.027878
    -0.005619 -0.004440

S2: -0.017807 -0.025040 +0.042114 +0.002230 +0.037720 +0.005943
    +0.003120 +0.033478 -0.011375 -0.024765 -0.020294 -0.051575
    -0.020081 -0.070496 -0.033569 -0.011398 -0.026627 -0.036469
    -0.020172 +0.000814

S3: +0.008209 +0.034180 +0.032867 +0.014320 -0.002916 +0.057526
    +0.023560 -0.035950 +0.012184 -0.007469 +0.017746 -0.030304
    +0.000773 +0.013351 +0.013885 +0.014763 +0.006618 +0.001346
    -0.030548 -0.020432
```

Claude Sonnet 4.6, asked to interpret these vectors:

> I can tell you, from these numbers, the model: dimensionality 1536
> plus normalization pattern fingerprints OpenAI text-embedding-3-small.
> I can tell you the statistical health is good. I cannot tell you what
> any of the three sentences actually said. I cannot tell you which
> sentence is sentence 1 versus sentence 2 versus sentence 3. The
> information is there. I can prove it is there statistically. But the
> information is unreadable to me without a text decoder pass.

This is the bottleneck. Until we build the layer that lets specialist
modules read each other's embeddings directly, we will keep paying for
this round trip in latency, in tokens, and in lost fidelity.
