# AI and LLM Simulation of Individual Decision-Makers for Policy Prediction and Political Forecasting (state of the art as of 15 Oct 2026)

Scope note: This file covers how ML, LLMs and LLM agents are used to predict policy decisions by modelling the people who make them (central bankers, legislators, judges, heads of state and negotiators), and how they are used to forecast political events. It does not review the reference list of Park et al., "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals" ([arXiv:2411.10109, v3](https://arxiv.org/abs/2411.10109)); another researcher covers that. Every arXiv ID and DOI below was checked in this session against the arXiv API or Crossref, or through the publisher or proceedings page. Venue labels show what was verified. "Preprint" means not confirmed as peer-reviewed. All dates are 2026 unless stated otherwise.

---

## Q1. Can LLM agents simulate individual central bankers or a monetary policy committee well enough to predict decisions?

### Takeaway
The FOMC is the most developed case. A July 2026 working paper by Kazinnik & Sinclair (Stanford DEL / GWU) gives one LLM agent to each FOMC member. In a backtest over 218 meetings (2000 to June 2026), it reports an 8.3 bp mean absolute error and over 90% correct hike/cut/hold calls, and it argues the result is not memorization. However, the paper is not peer-reviewed. It is a backtest, not a live record, and it is benchmarked against a random walk and Taylor rules, not against market pricing (fed funds futures or OIS). Its strongest use is counterfactual "what if the committee changes" analysis, not beating markets on the next meeting.

### Cited Findings
**Kazinnik & Sinclair, "FOMC In Silico: A Multi-Agent System for Monetary Policy Decision Modeling" (working paper; version dated 16 July 2026)**
- How it is built: each agent represents one FOMC member. Agents receive real-time macro data, district-level conditions, recent FOMC communications, members' recent speeches and financial news. Personas are built "using biographies, historical policy leanings, and recent public communication." The agents deliberate in natural language and then vote. — [NBER conference version, July 2026](https://conference.nber.org/conf_papers/f244384.pdf)
- A "stance evolution" module uses an LLM to label each member's recent public speeches as hawkish, dovish or data-dependent, weighting recent speeches more heavily. The simulation uses GPT-4o for opinion formation and deliberation and GPT-4o-mini for parsing. Each dissent threshold is calibrated so that simulated dissent matches the historical rate of roughly 4–8%. — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)
- Backtest results over 218 meetings (2000–June 2026): MAE 8.3 bp, RMSE 13.3 bp, within 25 bp of the realized rate in over 94% of meetings, and hike/cut/hold classified correctly in over 90%. On the 74 meetings where the Fed actually moved, the error was 12.8 bp with 92% directional accuracy. A random walk scored 37.0 bp and 0%; a static Taylor rule scored 35 bp and 66% directional accuracy. — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)
- Memorization test: asked directly, GPT-4o states the realized decision for 97.2% of meetings. The simulation's error is similar before and after the model's October 2023 training cutoff (8.2 bp over 196 pre-cutoff meetings vs 9.2 bp over 22 post-cutoff meetings; t = 0.5). Nine of the ten largest errors (including the March 2020 emergency cut) occur at meetings the model recalls correctly. The authors take this as evidence that the result is not retrieval. — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)
- Counterfactual "laboratory" results:
  - A President's rate demand made privately to the chair is outvoted and has no effect. Made publicly, it shifts members' own preferred rate by about one-tenth of the amount asked.
  - In a stagflation scenario, replacing 4 of 12 members with historical hawks moves the year-end rate by 168 bp, far more than changing the chair or the mandate.
  - Deliberation does not improve forecast accuracy over mechanically aggregating individual views, but removing discussion raises dissent by about 40%.
  - Source: [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)
- An earlier draft (29 Oct 2025) paired the LLM track with a Monte Carlo Bayesian voting model (generalizing Riboni & Ruge-Murcia). Replicating the July 2025 meeting gave 4.42% (LLM) vs 4.38% (MC). Under a political-pressure scenario, the LLM track showed dissent in 88% of runs vs 61% for MC. — [ECB conference copy, Oct 2025 draft](https://www.ecb.europa.eu/press/conferences/shared/pdf/20260323_forecasting/Kazinnik_paper.pdf); [Stanford Digital Economy Lab page](https://digitaleconomy.stanford.edu/publication/fomc-in-silico-a-multi-agent-system-for-monetary-policy-decision-modeling)
- The acknowledgments list presentations at a Bank of England Monetary Policy Committee meeting and the 13th ECB Conference on Forecasting Techniques, which indicates central-bank interest. — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)

**Other FOMC agent simulations**
- MiniFed (Seok, Wen, Yang, Feng, Yang; arXiv Oct 2024, preprint) is a five-stage simulation in which LLM agents play real FOMC members. It claims "high accuracy in Federal Funds rate projections and behavioral alignment" with the real members. — [arXiv:2410.18012](https://arxiv.org/abs/2410.18012)
- FedSight AI (Hou et al.; NeurIPS 2025 Generative AI in Finance workshop) has member agents read structured indicators and the Beige Book, debate and vote. On the 2023–2024 meetings it reports 93.75% accuracy and 93.33% "stability," beating MiniFed and an ordinal random forest. — [arXiv:2512.15728](https://arxiv.org/abs/2512.15728)
- I found no published LLM simulation of the ECB Governing Council or the Bank of England MPC as decision-makers. The nearest work found was an unverified lead on synthetic LLM traders interpreting ECB press conferences. — [search result pointing to arXiv 2511.02469; not verified](https://arxiv.org/pdf/2511.02469v1)

**"Reading the Fed": NLP of central bank text (models the text, not the person)**
- Hansen & Kazinnik, "Can ChatGPT Decipher Fedspeak?" (SSRN 2023; Richmond Fed 2024): GPT models classify the policy stance of FOMC statements considerably better than other common methods (BERT, dictionaries). GPT-4 explains its labels in ways comparable to a human analyst. — [FRBSF/Richmond Fed summary](https://www.frbsf.org/research-and-insights/publications/system-research-richmond-fed/can-chatgpt-decipher-fedspeak/); [Axios](https://www.axios.com/2023/04/17/new-chatgpt-task-deciphering-fed-messages)
- Peskoff, Visokay, Schulhoff, Wachspress, Blinder, Stewart (EMNLP Findings 2023), "GPT Deciphering Fedspeak: Quantifying Dissent Among Hawks and Doves." This is member-level hawk/dove measurement with GPT; co-author Alan Blinder is a former Fed Vice Chair. — [DOI 10.18653/v1/2023.findings-emnlp.434](https://doi.org/10.18653/v1/2023.findings-emnlp.434)
- Shah, Paturi & Chava (ACL 2023), "Trillion Dollar Words": a hawkish/dovish labelled FOMC dataset, with a market analysis. — [DOI 10.18653/v1/2023.acl-long.368](https://doi.org/10.18653/v1/2023.acl-long.368)
- Hansen, McMahon & Prat (QJE 2018) apply computational linguistics to FOMC transcripts to study how transparency changed deliberation. — [DOI 10.1093/qje/qjx045](https://doi.org/10.1093/qje/qjx045)
- Gorodnichenko, Pham & Talavera (AER 2023), "The Voice of Monetary Policy": the Fed Chair's vocal tone carries information. — [DOI 10.1257/aer.20220129](https://doi.org/10.1257/aer.20220129)
- Aruoba & Drechsel (NBER WP 32417), "Identifying Monetary Policy Shocks: A Natural Language Approach." — [NBER w32417](https://www.nber.org/papers/w32417)
- Gambacorta et al. (BIS WP 1215, 2024), "CB-LMs: language models for central banking." — [BIS](https://www.bis.org/publ/work1215.htm)
- Hansen, Horton, Kazinnik, Puzzello & Zarifhonarvar, "Simulating the Survey of Professional Forecasters" (SSRN): LLM personas used as synthetic macro forecasters. — [DOI 10.2139/ssrn.5066286](https://doi.org/10.2139/ssrn.5066286)

### Inferences
- FedSight's 93.75% on 2023–2024 most likely equals 15 of 16 meetings (8 FOMC meetings per year). The sample is tiny, and most of those meetings were well telegraphed holds or hikes.
- I searched the July 2026 FOMC In Silico text for "futures," "baseline" and "benchmark." The benchmarks named are a random walk, Taylor rules and the Monte Carlo voting model. I found no comparison with fed funds futures or OIS-implied probabilities. Markets usually price FOMC decisions with high confidence just before meetings, so the commercial question (does it add information beyond market pricing?) is unanswered.
- The post-cutoff validation covers only 22 meetings, a thin base for ruling out memorization.
- The most useful finding for a hedge fund may be that composition matters more than the chair or the mandate (the 168 bp swing). This makes persona-level modelling most valuable when membership changes (new governors, voter rotation, a new chair) and when policymakers face pressure, which are exactly the cases where historical regressions break.
- "Deliberation builds consensus but doesn't improve the forecast" suggests that cheaper designs (independent persona forecasts, then aggregation) may match full multi-agent debate on accuracy.

### Gaps
- None of the FOMC simulations has a published live, pre-registered forecast record.
- Did not verify: Takano, Hirano & Nakagawa's multi-round LLM debate classifying hawkish/dovish decisions (search pointed to arXiv 2508.13635), and the Central Bank of Malta "synthetic traders" paper.
- I found no verified evidence of an LLM simulation of ECB, BoE, BoJ or PBoC committees predicting decisions.

---

## Q2. Can LLMs simulate legislators and predict roll-call or parliamentary votes?

### Takeaway
Yes, moderately well. Persona-prompted LLMs reach about 0.79 weighted F1 on individual European Parliament votes. Agent frameworks claim gains over embedding baselines in the US House, and LLM-based ideal points correlate strongly with established measures. These tasks have strong baselines (party line), and published papers rarely report how much the LLM adds on the hard cases: rebels, swing votes and cross-party coalitions.

### Cited Findings
- Political Actor Agent (PAA), Li, Gong & Jiang (AAAI 2025):
  - What it is: role-playing LLM agents built to predict roll-call votes, presented as more interpretable and less data-hungry than embedding methods.
  - Data: tested on the 117th–118th US House, with claims of superior accuracy and interpretability. — [arXiv:2412.07144](https://arxiv.org/abs/2412.07144); [DOI 10.1609/aaai.v39i1.32017](https://doi.org/10.1609/aaai.v39i1.32017)
  - Pipeline (secondary review): Wikipedia pages, bill texts and voting records feed profile construction, then "multi-view planning" from trustee and delegate perspectives, then simulated legislative action. — [Moonlight review](https://themoonlight.io/review/political-actor-agent-simulating-legislative-system-for-roll-call-votes-prediction-with-large-language-models)
- Kreutner, Lutz & Strohmaier (Findings of EACL 2026), "Persona-driven Simulation of Voting Behavior in the European Parliament with LLMs":
  - Zero-shot persona prompts with limited information predict individual MEP votes with weighted F1 ≈ 0.793 and aggregate to party-group positions.
  - They test stability under counterfactual arguments and different persona prompts, and note that LLMs "consistently exhibit a progressive left-leaning bias."
  - Data and code are released.
  - [arXiv:2506.11798](https://arxiv.org/abs/2506.11798); [DOI 10.18653/v1/2026.findings-eacl.25](https://doi.org/10.18653/v1/2026.findings-eacl.25)
- Baker & Azher (arXiv 2024, preprint), "Simulating The U.S. Senate": each agent represents a senator on the Senate Intelligence Committee. Agents held realistic debates and, under external perturbations, shifted toward bipartisanship. The evaluation is qualitative. — [arXiv:2406.18702](https://arxiv.org/abs/2406.18702)
- Wu, Nagler, Tucker & Messing (arXiv 2023), "Large Language Models Can Be Used to Estimate the Latent Positions of Politicians":
  - Method: the LLM compares senators pairwise, then a Bradley–Terry model scales the comparisons.
  - The liberal–conservative scale correlates strongly with existing measures.
  - New gun-control and abortion scales predict interest-group ratings and votes better than ideology alone.
  - [arXiv:2303.12057](https://arxiv.org/abs/2303.12057)
- O'Hagan & Schein (arXiv 2023): LLM-elicited ideological scores of legislators "accord closely to established methods." — [arXiv:2312.09203](https://arxiv.org/abs/2312.09203)
- "Digital Pantheon" (Van Mulders, Bogaert & Van den Poel; ECML PKDD 2026 AIDEM workshop):
  - The authors argue that RLHF's "neutrality and helpfulness biases… prevent them from sustaining steadfast partisan behaviour."
  - Their fix combines SFT and DPO to instil party personas with RAG over each party's manifesto.
  - They simulate coalition formation after the 2019 Flemish election and trace each clause of the deal back to a manifesto.
  - [arXiv:2607.15095](https://arxiv.org/abs/2607.15095)
- ParliaBench (Koniaris, Tsipi & Tsanakas; LREC 2026) is a benchmark for evaluating LLM-generated parliamentary speech, relevant to "digital twins" that speak like a given politician. — [arXiv:2511.08247](https://arxiv.org/abs/2511.08247)
- Political-LLM (Li et al., arXiv Dec 2024) surveys LLM uses in political science, including simulation and prediction. — [arXiv:2412.06864](https://arxiv.org/abs/2412.06864)

### Inferences
- In polarized chambers, a party-line rule already predicts most individual votes. An F1 of 0.79 should be read against that baseline. The commercially valuable signal is in defections, swing members, amendment votes and whether a bill reaches the floor at all (agenda control). These are under-tested.
- The Digital Pantheon finding matters for products: off-the-shelf chat models drift toward moderate, agreeable positions. Faithful partisan simulation needs fine-tuning or retrieval grounding in each actor's own record. This links directly to the Park et al. idea of grounding agents in rich individual data.

### Gaps
- I found no study that runs live, pre-registered LLM predictions of upcoming US Congress or EU Parliament votes with a public track record.
- The "LegiSim" name in the brief could not be verified as a specific paper.
- From the abstract, I could not tell whether Kreutner et al. compare against a party-line baseline.

---

## Q3. Can ML or LLMs predict court and judge decisions?

### Takeaway
Classic ML on case metadata reached about 70% accuracy on US Supreme Court outcomes (Katz et al. 2017). The first systematic forward test of frontier LLMs on a full Supreme Court term (October Term 2025) found that headline accuracy overstates skill. Much of it comes from knowing each justice's ideology, and the models overpredict ideologically split outcomes.

### Cited Findings
- Katz, Bommarito & Blackman (PLOS ONE 2017) built a time-evolving random forest on case and justice features, reaching about 70% accuracy on case outcomes. — [DOI 10.1371/journal.pone.0174698](https://doi.org/10.1371/journal.pone.0174698); [PMC full text](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5389610/)
- Ruger, Kim, Martin & Quinn (Columbia Law Review 2004), "The Supreme Court Forecasting Project," compared a statistical model with legal experts' predictions. — [DOI 10.2307/4099370](https://doi.org/10.2307/4099370)
- Martin & Quinn (Political Analysis 2002) introduced dynamic ideal points for justices (the "Martin–Quinn scores"). — [DOI 10.1093/pan/10.2.134](https://doi.org/10.1093/pan/10.2.134)
- Predicting European Court of Human Rights outcomes from case text:
  - Aletras et al., PeerJ CS 2016 — [DOI 10.7717/peerj-cs.93](https://doi.org/10.7717/peerj-cs.93)
  - Medvedeva, Vols & Wieling, AI & Law 2020 — [DOI 10.1007/s10506-019-09255-y](https://doi.org/10.1007/s10506-019-09255-y)
  - Chalkidis, Androutsopoulos & Aletras, ACL 2019 — [arXiv:1906.02059](https://arxiv.org/abs/1906.02059)
- Hamilton, "Blind Judgement" (AAAI-23 workshop): nine models, each trained on one justice's opinions, were tested on 96 cases from 2010–2016. Accuracy was better than random. — [arXiv:2301.05327](https://arxiv.org/abs/2301.05327)
- Stillwell & Harrington, "Predicting the Court: Evaluating Large Language Models as Forecasters of Supreme Court Decisions" (SSRN, 10 July 2026):
  - Setup: GPT-5, Gemini 2.5 Pro, Claude Sonnet 4.5 and Grok 4 predicted every argued merits case of October Term 2025.
  - Main result: conventional metrics overstate their ability. Much of the justice-level accuracy reflected the Court's usual ideological alignment rather than case-specific legal reasoning.
  - Bias: the models systematically overpredicted ideologically divided decisions, especially in salient cases the Court resolved on narrow, technical grounds.
  - [abstract via beSpacific](https://www.bespacific.com/?p=126584) (the SSRN page was not reached directly)
- Aldahoul et al. (arXiv 2025) asked LLMs to vote as justices on 1,749 cases to measure LLM ideology. This measures ideology rather than forecasting outcomes. — [arXiv:2505.04171](https://arxiv.org/abs/2505.04171)

### Inferences
- Stillwell & Harrington's finding is a clean example of "stereotyping/flattening" in elite simulation. Models fall back on a crude left/right prior and miss narrow, technical or unanimous resolutions, which are exactly the cases where a forecaster could add value over a simple ideology model.

### Gaps
- I could not access the Stillwell & Harrington full text for exact accuracy figures or baseline comparisons.
- I found no peer-reviewed LLM study of predicting lower-court or agency adjudication decisions for trading use.

---

## Q4. Can LLMs simulate heads of state, negotiators and crisis decision-makers (diplomacy and wargames)?

### Takeaway
LLMs can play diplomacy and crisis games at a human-like level (CICERO). Crisis-simulation research consistently finds that LLM "leaders" behave differently from human experts: they escalate more in some setups and argue more cooperatively in others, they vary by model, and they carry country-specific biases. No study validates LLM twins of specific living leaders against their real later decisions. In this domain LLM simulations are tools for exploring scenarios, not for prediction.

### Cited Findings
- Meta FAIR Diplomacy Team (Bakhtin, Brown, Dinan et al.; Science 2022), CICERO: human-level play in the negotiation game Diplomacy, combining a language model with strategic reasoning. — [DOI 10.1126/science.ade9097](https://doi.org/10.1126/science.ade9097)
- Hua et al. (arXiv 2023), WarAgent: LLM agents play countries in WWI, WWII and China's Warring States period to study the triggers of war. — [arXiv:2311.17227](https://arxiv.org/abs/2311.17227)
- Rivera, Mukobi, Reuel, Lamparth, Smith & Schneider (FAccT 2024), "Escalation Risks from Language Models in Military and Diplomatic Decision-Making":
  - All five off-the-shelf LLMs showed escalation and hard-to-predict escalation patterns, including arms-race dynamics and, rarely, nuclear use.
  - Their stated reasons cited deterrence and first-strike logic.
  - [arXiv:2401.03408](https://arxiv.org/abs/2401.03408); [DOI 10.1145/3630106.3658942](https://doi.org/10.1145/3630106.3658942)
- Lamparth, Corso, Ganz, Mastro, Schneider & Trinkunas (AIES 2024), "Human vs. Machine":
  - 214 national-security experts were compared with LLM-simulated teams in a US–China crisis game.
  - There was considerable high-level agreement, but significant differences in individual actions. LLM responses can be more aggressive and are strongly affected by scenario changes.
  - [arXiv:2403.03407](https://arxiv.org/abs/2403.03407); [DOI 10.1609/aies.v7i1.31681](https://doi.org/10.1609/aies.v7i1.31681)
- Jensen et al. (CSIS Futures Lab; arXiv 2025), Critical Foreign Policy Decisions Benchmark:
  - 400 expert-written international-relations scenarios.
  - Models differ significantly in how escalatory their recommendations are.
  - All show country-specific biases, for example less escalatory recommendations toward China and Russia.
  - [arXiv:2503.06263](https://arxiv.org/abs/2503.06263)
- Solopova et al. (arXiv March 2026): six LLMs vs humans in four real-world crisis scenarios. Models track human choices in early rounds but diverge over time, and their explanations are "normative-cooperative" with "limited adversarial reasoning." — [arXiv:2603.02128](https://arxiv.org/abs/2603.02128)
- Mukobi et al. (arXiv 2023), Welfare Diplomacy, a cooperation benchmark — [arXiv:2310.08901](https://arxiv.org/abs/2310.08901)
- Hogan & Brennen (arXiv 2024), "Snow Globe," open-ended LLM wargames — [arXiv:2404.11446](https://arxiv.org/abs/2404.11446)

### Inferences
- The two failure modes pull in opposite directions: escalation bias in some designs, cooperative framing in others. Together they show that model choice and prompt framing, not the simulated leader's real character, drive a large share of the outcome. A product that simulates a named leader without grounding and calibration would mostly be reporting the base model's priors.

### Gaps
- I found no peer-reviewed study testing LLM "digital twins" of named, living heads of state (built from their speeches) against their actual later decisions.
- I did not retrieve the original "Payne (2026)" nuclear-crisis simulation paper, which Solopova et al. cite according to a search summary.

---

## Q5. What did pre-LLM machine learning achieve in predicting decision-makers?

### Takeaway
Before LLMs, political scientists and ML researchers built a strong toolkit for predicting decision-makers:
- ideal-point models from votes (where each legislator or justice sits on a left–right scale);
- extensions that use bill text to predict votes on new bills;
- text-only ideal points;
- bill-survival models;
- metadata models for courts.

These remain the baselines that LLM simulations must beat.

### Cited Findings
- Clinton, Jackman & Rivers (APSR 2004), "The Statistical Analysis of Roll Call Data": the Bayesian ideal-point standard. — [DOI 10.1017/S0003055404001194](https://doi.org/10.1017/S0003055404001194)
- Gerrish & Blei (ICML 2011), "Predicting Legislative Roll Calls from Text": combines ideal points with topic models to predict votes on new bills from their text, tested on 12 years of data. Standard ideal-point models "cannot predict how legislators will vote on future legislation." — [ICML PDF](https://icml.cc/imls/conferences/2011/papers/333_icmlpaper.pdf)
- Gerrish & Blei (NIPS 2012), "How They Vote: Issue-Adjusted Models of Legislative Behavior." — [PDF, Blei's site](https://www.cs.columbia.edu/~blei/papers/GerrishBlei2012.pdf)
- Kraft, Jain & Rush (EMNLP 2016), "An Embedding Model for Predicting Roll-Call Votes." — [DOI 10.18653/v1/D16-1221](https://doi.org/10.18653/v1/D16-1221)
- Kornilova, Argyle & Eidelman (ACL 2018), "Party Matters: Enhancing Legislative Embeddings with Author Attributes for Vote Prediction." — [DOI 10.18653/v1/P18-2081](https://doi.org/10.18653/v1/P18-2081)
- Vafa, Naidu & Blei (ACL 2020), "Text-Based Ideal Points": estimates political positions from text alone. — [DOI 10.18653/v1/2020.acl-main.475](https://doi.org/10.18653/v1/2020.acl-main.475); [arXiv:2005.04232](https://arxiv.org/abs/2005.04232)
- Yano, Smith & Wilkerson (NAACL 2012), "Textual Predictors of Bill Survival in Congressional Committees": adding bill-text features to sponsor and committee features significantly reduces error in predicting whether a bill survives committee. — [ACL Anthology N12-1097](https://aclanthology.org/N12-1097/)
- Nay (PLOS ONE 2017), "Predicting and understanding law-making with word vectors and an ensemble model." — [DOI 10.1371/journal.pone.0176999](https://doi.org/10.1371/journal.pone.0176999)
- Supreme Court and ECtHR prediction (Katz et al. 2017; Ruger et al. 2004; Martin & Quinn 2002; Aletras et al. 2016) are covered under Q3.

### Inferences
- LLM papers often compare against weak baselines (random, simple embeddings). Industry evaluations should include these classical baselines: ideal points, party line, Martin–Quinn scores, sponsor and committee features, and Taylor rules or market pricing for central banks.

### Gaps
- I did not verify the accuracy figures inside the Gerrish & Blei, Kraft et al. and Yano et al. papers, so none are quoted.

---

## Q6. How good are LLMs at forecasting real-world (including political) events?

### Takeaway
LLM forecasting has gone from clearly below human crowds (2023–24) to roughly superforecaster level on the ForecastBench benchmark (late 2025 to mid-2026). Bridgewater's AIA Labs and others report statistical parity there. In September 2026 an AI system (Mantic) beat every human in a Metaculus tournament. However, on Metaculus's quarterly bot benchmarks through 2025, professional forecasters kept a lead, though it was shrinking and by one later round no longer statistically significant. On liquid prediction markets, the best published AI system still underperforms the market consensus, although it adds information when combined with it. Results depend heavily on how leakage is controlled.

### Cited Findings
**Benchmarks and academic results**
- Zou et al. (NeurIPS 2022), Autocast: an early dataset for neural forecasting of world events. — [arXiv:2206.15474](https://arxiv.org/abs/2206.15474)
- Halawi, Zhang, Yueh-Han & Steinhardt (NeurIPS 2024), "Approaching Human-Level Forecasting with Language Models": a retrieval-augmented system evaluated on questions published after the models' knowledge cutoffs. It "nears the crowd aggregate of competitive forecasters, and in some settings surpasses it." — [arXiv:2402.18563](https://arxiv.org/abs/2402.18563); [DOI 10.52202/079017-1598](https://doi.org/10.52202/079017-1598)
- Schoenegger, Tuminauskaite, Park, Bastos & Tetlock (Science Advances 2024), "Wisdom of the silicon crowd":
  - An ensemble of 12 LLMs on 31 binary questions was not statistically different from a 925-person human crowd.
  - The models showed an "acquiescence effect," with mean predictions above 50% even though outcomes split roughly evenly.
  - [DOI 10.1126/sciadv.adp1528](https://doi.org/10.1126/sciadv.adp1528); [arXiv:2402.19379](https://arxiv.org/abs/2402.19379)
- Schoenegger, Park, Karger, Trott & Tetlock (preprint 2024), "AI-Augmented Predictions": with N = 991, LLM assistants improved human forecasting accuracy by 24–28% over a control. Even a deliberately noisy, overconfident assistant helped. — [arXiv:2402.07862](https://arxiv.org/abs/2402.07862)
- Pratt, Blumberg, Carolino & Morris (preprint 2024), "Can Language Models Use Forecasting Strategies?": models "still struggle," partly because they tend to guess that events are unlikely. — [arXiv:2406.04446](https://arxiv.org/abs/2406.04446)
- Karger et al., ForecastBench (arXiv 2024; reported as ICLR 2025, venue not verified here):
  - About 1,000 automatically generated questions about unresolved future events, designed to avoid leakage.
  - At launch, experts beat the top LLM (p < 0.001).
  - [arXiv:2409.19839](https://arxiv.org/abs/2409.19839)
- Forecasting Research Institute (FRI) updates:
  - Oct 2025: superforecasters scored a Brier of 0.081 vs GPT-4.5's 0.101. — [FRI Substack, Oct 2025](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark)
  - 29 Jan 2026: the gap had narrowed to 0.017 Brier, with Grok 4.20 (Preview) at 0.102 vs Claude 3.5 Sonnet's 0.117 a year earlier. Parity was extrapolated to November 2026 (95% CI Jan 2026–Nov 2027), with June 2026 for "dataset" questions and August 2026 for "market" questions. The authors caution that linear extrapolation may break down. — [FRI Substack, Jan 2026](https://forecastingresearch.substack.com/p/llms-are-closing-the-gap-on-human)
- Bridgewater AIA Labs (Alur, Stadie, Kang, … Sekhon; arXiv Nov 2025), "AIA Forecaster: Technical Report":
  - Design: agentic news search, a supervisor agent that reconciles forecasts, and statistical calibration "to counter behavioral biases in LLMs."
  - On ForecastBench it achieves "performance equal to human superforecasters."
  - On a new benchmark drawn from liquid prediction markets it underperforms the market consensus, but an ensemble of AIA and the market beats the market alone.
  - [arXiv:2511.07678](https://arxiv.org/abs/2511.07678)
- Lightning Rod Labs blog (8 July 2026; the company sells forecasting models): on the ForecastBench leaderboard as of 6 July 2026, "the best AI forecasters are statistically indistinguishable from the best humans" (Gemini, the Cassi ensemble, and Lightning Rod's Foresight-v3). Superforecaster median Brier Index 69.3 vs Foresight-v3 at 67.7. — [Lightning Rod blog](https://blog.lightningrod.ai/p/ai-reaches-human-superforecaster-range)
- Turtel, Franklin, Skotheim, Hewitt & Schoenegger (preprint 2025): outcome-based RL trains a 14B model to match or beat o1 with better calibration. A simulated Polymarket strategy gave over 10% ROI on the test set. — [arXiv:2505.17989](https://arxiv.org/abs/2505.17989)
- Ye et al. (preprint 2024), MIRAI: an agent benchmark for forecasting international-relations events using a cleaned GDELT event database and news. — [arXiv:2407.01231](https://arxiv.org/abs/2407.01231)
- Zeng et al. (preprint 2025), FutureX: a live, daily-updated future-prediction benchmark evaluating 25 LLMs and agents, designed to eliminate contamination. — [arXiv:2508.11987](https://arxiv.org/abs/2508.11987)
- FutureSearch (Wildman, Bosse et al.; preprint 2025), "Bench to the Future": a "pastcasting" benchmark with a frozen web snapshot. — [arXiv:2506.21558](https://arxiv.org/abs/2506.21558)
- Paleka et al. (preprint, ICLR 2025 submission), "Consistency Checks for Language Model Forecasters." — [arXiv:2412.18544](https://arxiv.org/abs/2412.18544)

**Live tournaments (human vs bot)**
- Metaculus Q1 2025 AI benchmark, "Pro forecasters crush bots": 34 bot makers, 424 questions, with 10 Pros forecasting 100 of them. — [Metaculus post on LessWrong](https://www.lesswrong.com/posts/rDy5z8ZEtMrEGnfBd/q1-ai-benchmark-results-pro-forecasters-crush-bots)
- Metaculus Q2 2025: Pros beat the top-10 bot team with p = 0.00001. There were 348 questions and 54 bot makers. An o3-based bot was best among the same-prompt Metaculus bots and 2nd overall. — [Metaculus post on LessWrong](https://www.lesswrong.com/posts/Surnjh8A4WjgtQTkZ/q2-ai-benchmark-results-pros-maintain-clear-lead)
- A later Metaculus "FutureEval Spring" round (exact period to confirm): Pros led the top-10 bot team by only 1.25 head-to-head points per question, not statistically significant (one-sided p = 0.247). — [LessWrong](https://www.lesswrong.com/posts/wZBbDqzfBjYG58CxK/futureeval-spring-results-pros-beat-bots-but-the-gap-is)
- Mantic (London startup): secondary coverage says a Mantic bot finished 8th of 549 in the Summer 2025 Metaculus Cup, the first bot in the top 10. — [secondary: Let's Data Science](https://www.letsdatascience.com/news/ai-forecasters-outperform-humans-in-prediction-tournaments-6c033227)
- Reuters (18 Sep 2026):
  - In the Summer 2026 Metaculus Cup, Mantic outperformed every human contestant and all bots except one ("laertes"), on political, economic and cultural questions.
  - Mantic raised a $25M seed round led by Radical Ventures, with M12 and Thinking Machines Lab among the backers.
  - An investor said hedge funds and trading firms were especially eager for its forecasts.
  - [Reuters via The Star](https://www.thestar.com.my/tech/tech-news/2026/09/18/ai-startup-mantic-raises-25-million-for-superhuman-forecasting)
- Good Judgment Inc. says its client work points to a slower timeline for AI parity than FRI suggests. — [Good Judgment blog](https://goodjudgment.com/tag/forecasting/)
- An EA Forum review (2026) of 11 analyses distrusts the parity claims as conclusive, citing backtesting and leakage concerns, and calls for live tournaments. — [EA Forum](https://forum.effectivealtruism.org/posts/Spyz3wESZu2eeqhDj/ai-forecasting-in-2026-what-11-analyses-say)

### Inferences
- The state of the art as of October 2026 is that AI forecasting is roughly at superforecaster level on broad, binary, mostly short-horizon questions. That is good enough to matter. It has not been shown to beat liquid markets on their own questions, which is the bar a hedge fund cares about.
- The AIA result (worse than the market alone, better when combined with it) is the realistic use case: AI forecasts as a diversifying signal.
- Wording matters for the reader: "matches superforecasters" (ForecastBench, Jan–Jul 2026) and "beats all humans in one tournament" (Mantic, Sep 2026) are different claims from "beats Metaculus Pros consistently," which was not shown through 2025.

### Gaps
- I did not find a peer-reviewed paper confirming parity in a live tournament.
- I did not find ForecastBench results broken out by policy or political topics.
- The official Metaculus Summer 2026 Cup results page was not checked directly.

---

## Q7. Can LLMs simulate public opinion, voters and stakeholders as inputs to policy prediction?

### Takeaway
LLM "silicon samples" can reproduce broad average opinion patterns ("algorithmic fidelity"). They are unreliable for variance, subgroups, new issues and real elections: Aaru's AI poll wrongly called the 2024 US presidential race for Harris. Simulating stakeholder or public comments on regulations is largely unstudied as a prediction tool.

### Cited Findings
- Argyle, Busby, Fulda, Gubler, Rytting & Wingate (Political Analysis 2023), "Out of One, Many": conditioning a language model on demographic backstories can mimic human subgroup survey responses. — [DOI 10.1017/pan.2023.2](https://doi.org/10.1017/pan.2023.2)
- Bisbee, Clinton, Dorff, Kenkel & Larson (Political Analysis 2024), "Synthetic Replacements for Human Survey Data? The Perils of Large Language Models": a critique showing why synthetic responses are not a reliable substitute. — [DOI 10.1017/pan.2024.5](https://doi.org/10.1017/pan.2024.5)
- Santurkar et al. (2023), "Whose Opinions Do Language Models Reflect?": LM opinions are misaligned with many US demographic groups. — [arXiv:2303.17548](https://arxiv.org/abs/2303.17548)
- Wang, Morgenstern & Dickerson (Nature Machine Intelligence 2025): LLMs that replace human participants "can harmfully misportray and flatten identity groups." — [DOI 10.1038/s42256-025-00986-z](https://doi.org/10.1038/s42256-025-00986-z)
- Kim & Lee (preprint 2023), "AI-Augmented Surveys": LLMs combined with survey data for opinion prediction. — [arXiv:2305.09620](https://arxiv.org/abs/2305.09620)
- Jiang, Wei & Zhang (preprint 2024), "Donald Trumps in the Virtual Polls." — [arXiv:2411.01582](https://arxiv.org/abs/2411.01582)
- Zhang et al. (preprint 2024), ElectionSim: a million-scale voter pool sampled from social media, plus a poll-based presidential election benchmark. — [arXiv:2410.20746](https://arxiv.org/abs/2410.20746)
- Aaru (AI polling startup):
  - Its June 2024 NY Democratic primary call came within 371 votes using only AI agents. — [Semafor, 20 Sep 2024](https://semafor.com/article/09/20/2024/ai-startup-aaru-uses-chatbots-instead-of-humans-for-political-polls)
  - For the 2024 general election it ran at least 1,000 agent "voters" per swing state and predicted a narrow Harris Electoral College win; Trump won. — [Semafor, 4 Nov 2024](https://semafor.com/article/11/04/2024/an-ai-polling-startup-polls-bots-predicts-harris-will-win); [Semafor, 6 Nov 2024](https://semafor.com/article/11/06/2024/ai-startup-aaru-defends-using-artificial-intelligence-for-polling)
- Ashokkumar, Hewitt, Ghezae & Willer (OSF preprint), "Large language models can predict the results of social science experiments." — [DOI 10.31234/osf.io/3svep_v1](https://doi.org/10.31234/osf.io/3svep_v1)
- Regulatory comments:
  - GW Regulatory Studies Center (2023) tested whether ChatGPT can mimic public submissions to agency rulemakings and judged it unlikely to introduce novel problems, given existing safeguards. — [GW RSC](https://regulatorystudies.columbian.gwu.edu/node/4321)
  - Arsenault & Kreps (Big Data & Society, 2026) find LLMs may help citizens draft comments but could widen disparities. — [SSRC MediaWell citation](https://mediawell.ssrc.org/citations/whose-voice-counts-the-role-of-large-language-models-in-public-commenting/)
  - An empirical study applies LLMs and sentiment analysis to 84,826 comments across 512 SEC rulemakings. It analyses real comments; it does not simulate them. — [U. Michigan Law repository](https://repository.law.umich.edu/pub_law_archive/34)

### Inferences
- For policy prediction, synthetic publics are best used to explore how a message or policy might land with different groups. They should not replace polls. Persona grounding in real individual data (the Park et al. approach) is the main proposed fix for flattening, and the Q2 and Q3 evidence shows elite simulations suffer the same flattening.

### Gaps
- I found no study that simulates stakeholder comments to predict the content of final regulations.

---

## Q8. How are hedge funds and asset managers actually using LLMs for policy analysis? (verifiable items only)

### Takeaway
Verified uses fall into four groups:
- JPMorgan's 2023 Hawk-Dove score: an LLM reading of Fed speeches.
- Balyasny: using chatbots to cut central-bank meeting previews from about two days to about 30 minutes.
- Bridgewater's AIA Labs: an ML-driven fund and a published LLM forecaster that matches superforecasters but not markets.
- Man Group's AlphaGPT: agentic signal research.

No verified source shows a fund running LLM "digital twins" of named policymakers to trade. The most-cited skeptic, Ken Griffin, says GenAI helps productivity but "falls short" for alpha.

### Cited Findings
- JPMorgan (Apr 2023): economists led by Joseph Lupton built a ChatGPT-based model scoring 25 years of Fed statements and speeches on a hawk–dove scale. It was also applied to the ECB and BoE. Rising hawkishness between meetings preceded more hawkish statements and higher 1-year T-bill yields. The authors called the results early. — [BNN Bloomberg, 26 Apr 2023](https://www.bnnbloomberg.ca/jpmorgan-s-ai-puts-25-years-of-fed-speeches-into-a-hawk-dove-score-1.1912721)
- Balyasny:
  - Bloomberg (14 Aug 2024) reports that macro chief economist Chris Pulman's central-bank meeting previews went from about two days to about 30 minutes using chatbots. The bots summarize economists' views, generate charts and extract officials' latest pronouncements. — [Bloomberg](https://www.bloomberg.com/news/articles/2024-08-14/hedge-funds-battle-to-turn-chatgpt-from-intern-to-analyst)
  - Trade press (Mar 2026) describes an AI research platform used by about 180 investment teams, built by a 20-person Applied AI group formed in late 2022. — [CFOtech](https://cfotech.co.uk/story/balyasny-builds-ai-research-platform-for-hedge-fund-teams)
- Bridgewater:
  - Greg Jensen told Business Insider (Nov 2023) that the AIA Lab (about 20 investors and ML scientists) was building a fund in which AI and ML would generate, test and trade ideas, under human oversight with a "kill switch." — [Business Insider](https://www.businessinsider.nl/bridgewater-building-ai-fund-machine-learning-greg-jensen-2023-11)
  - AIA Labs published the AIA Forecaster report (Nov 2025, see Q6). — [arXiv:2511.07678](https://arxiv.org/abs/2511.07678)
- Man Group:
  - Man describes AlphaGPT as three agents: idea generator, workflow orchestrator and evaluator, the last applying statistical, risk and economic-rationale checks. Man acknowledges hallucination and drift risks and says the system cannot run unsupervised. — [Man Group insight, Nov 2025](https://www.man.com/insights/what-ai-can-do-for-alpha)
  - Bloomberg-based trade coverage says it has produced several dozen signals approved for live trading. — [Hedgeweek](https://hedgeweek.com/news/man-group-deploys-agentic-ai-for-quant-signal-discovery)
- Citadel: Ken Griffin (15 Oct 2025, Robin Hood conference): "With GenAI there are clearly ways it enhances productivity, but for uncovering alpha it just falls short." — [Hedgeweek](https://www.hedgeweek.com/generative-ai-fails-to-deliver-alpha-for-hedge-funds-says-griffin/); [Bloomberg Government](https://news.bgov.com/new-york-brief/griffin-says-genai-fails-to-help-hedge-funds-beat-markets-1)
- Bloomberg LP built BloombergGPT (2023), a finance-domain LLM. — [arXiv:2303.17564](https://arxiv.org/abs/2303.17564)
- Mantic's investor says hedge funds and trading firms are keen on its forecasts. Customers are unnamed. — [Reuters via The Star](https://www.thestar.com.my/tech/tech-news/2026/09/18/ai-startup-mantic-raises-25-million-for-superhuman-forecasting)

### Inferences
- Current industry practice is mostly (a) LLMs reading and scoring policymaker text, (b) research automation, and (c) probabilistic event forecasts used as one input. Full agent-based "committee simulators" exist in academia (Q1), and central banks have heard presentations of them, but no verified fund deployment was found.

### Gaps
- Bridgewater's AI fund launch date, size and returns appear only in secondary wiki-style sources; I could not verify them.
- I found nothing verifiable on Two Sigma's LLM use for policy analysis.
- Balyasny's "BAM GPT" by that name was not confirmed in a primary source.

---

## Q9. What are the main limitations and risks?

### Takeaway
The biggest technical risk is look-ahead leakage: models have memorized history, so backtests flatter them. Next come persona flattening and political or ideological bias, sycophancy and RLHF "agreeableness," calibration quirks, and breakdown when the cast of decision-makers changes. On the legal side, insider-trading and MNPI rules apply to any non-public policy information, and simulating named real people raises consent and privacy questions that are largely unaddressed.

### Cited Findings
**Look-ahead and memorization**
- Lopez-Lira, Tang & Zhu (preprint 2025): LLMs "cannot be trusted for economic forecasts during periods covered by their training data." They recall exact values before their cutoff, instructions to respect dates fail, and masking fails. After the cutoff they show no recall. — [arXiv:2504.14765](https://arxiv.org/abs/2504.14765)
- Kazinnik & Sinclair's model recalled 97.2% of FOMC decisions directly, which shows why controls are needed (Q1). — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)
- Glasserman & Lin (preprint 2023) document look-ahead bias in GPT sentiment-based stock-return predictions. — [arXiv:2309.17322](https://arxiv.org/abs/2309.17322)
- Sarkar & Vafa (SSRN 2024), "Lookahead Bias in Pretrained Language Models." — [DOI 10.2139/ssrn.4754678](https://doi.org/10.2139/ssrn.4754678)
- Proposed fix: train time-restricted models. He, Lv, Manela & Wu (preprint 2025) train ChronoBERT and ChronoGPT on time-stamped data and find lookahead bias "modest" in one asset-pricing application. — [arXiv:2502.21206](https://arxiv.org/abs/2502.21206)
- Drinkall et al. (NAACL Findings 2024), "Time Machine GPT," also uses point-in-time models. — [arXiv:2404.18543](https://arxiv.org/abs/2404.18543)
- Paleka, Goel, Geiping & Tramèr (preprint 2025), "Pitfalls in Evaluating Language Model Forecasters": many forms of temporal leakage, and difficulty extrapolating from benchmarks to real-world forecasting. — [arXiv:2506.00723](https://arxiv.org/abs/2506.00723)

**Bias, flattening and caricature**
- Kreutner et al. note a "progressive left-leaning bias" in LLMs. — [arXiv:2506.11798](https://arxiv.org/abs/2506.11798)
- Van Mulders et al. find that RLHF neutrality prevents steadfast partisan personas. — [arXiv:2607.15095](https://arxiv.org/abs/2607.15095)
- Stillwell & Harrington find ideological overprediction for Supreme Court justices. — [beSpacific](https://www.bespacific.com/?p=126584)
- Cheng, Piccardi & Yang (EMNLP 2023), CoMPosT: characterizing caricature in LLM simulations. — [arXiv:2310.11501](https://arxiv.org/abs/2310.11501)
- Wang et al. (NMI 2025) document flattening of identity groups. — [DOI](https://doi.org/10.1038/s42256-025-00986-z)
- The CFPD benchmark finds country-specific biases, with less escalatory recommendations for China and Russia. — [arXiv:2503.06263](https://arxiv.org/abs/2503.06263)

**Sycophancy, calibration and model dependence**
- Sharma et al. (2023), "Towards Understanding Sycophancy in Language Models." — [arXiv:2310.13548](https://arxiv.org/abs/2310.13548)
- Calibration quirks: an acquiescence bias above 50% (Schoenegger et al.) vs a bias toward "unlikely" (Pratt et al.). AIA Labs adds explicit statistical calibration to counter LLM behavioral biases. — [Sci Adv](https://doi.org/10.1126/sciadv.adp1528); [arXiv:2406.04446](https://arxiv.org/abs/2406.04446); [arXiv:2511.07678](https://arxiv.org/abs/2511.07678)
- Escalation behaviour depends on the model and the scenario wording. — [Rivera et al.](https://doi.org/10.1145/3630106.3658942); [Lamparth et al.](https://doi.org/10.1609/aies.v7i1.31681)

**Distribution shift**
- In the FOMC simulation, committee composition swings outcomes by up to 168 bp. Personas must therefore be rebuilt as members rotate or change their views. — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)

**Legal: material non-public information (MNPI) and "political intelligence"**
- The STOCK Act–mandated GAO report (April 2013) found no laws or ethics rules that specifically govern the sale of political intelligence. Insider-trading and MNPI rules do apply, and GAO said it is hard to determine how much non-public government information is sold. — [Akin Gump summary](https://www.akingump.com/en/news-insights/stock-act-required-gao-report-on-political-intelligence.html); [Political Law Briefing](https://www.politicallawbriefing.com/2013/04/gao-issues-report-on-political-intelligence-activities/)

### Inferences
- A product built only on public speeches, votes and data is legally cleaner than human political-intelligence channels. If agents are fed notes from conversations with officials or staff, the MNPI risk returns.
- Post-cutoff evaluation windows are short (for example, 22 FOMC meetings). Pre-registered live forecasting is the only robust validation.

### Gaps
- I found no specific legal analysis or regulatory guidance (SEC, FCA, EU AI Act) on building commercial LLM "digital twins" of named public officials. Ethics of simulating real individuals is covered in the Park et al. stream; I did not research it here.

---

## Q10. Plain-language state of the art (Oct 2026), and how a hedge fund or policy-intelligence product could use it

### Takeaway
There are three generations of tools:
1. **Statistical maps of decision-makers.** Ideal points place each legislator or justice on a scale; text and metadata models add bill and case content.
2. **LLMs that read policymaker text.** Hawk/dove scoring of Fed speeches and FOMC statements.
3. **LLM agents that role-play each decision-maker and deliberate.** FOMC In Silico, PAA, the EU Parliament personas, Supreme Court predictions. Alongside these sit general LLM forecasters that are now near superforecaster level.

Generation 3 is promising but immature. Its best-validated results are backtests on predictable bodies (FOMC, party-line legislatures). Its most distinctive value is "what if" analysis: new members, new chairs, political pressure, novel bills. Forward tests show systematic biases (ideology, escalation, agreeableness).

### Cited Findings
- FOMC agents: 8.3 bp MAE over a 218-meeting backtest, with error similar before and after the training cutoff; composition counterfactuals of 168 bp. — [NBER version](https://conference.nber.org/conf_papers/f244384.pdf)
- EU Parliament persona prediction: weighted F1 ≈ 0.79. — [arXiv:2506.11798](https://arxiv.org/abs/2506.11798)
- On the October Term 2025 Supreme Court, frontier LLMs' accuracy is overstated by ideology priors. — [beSpacific](https://www.bespacific.com/?p=126584)
- The AI forecaster matches superforecasters on ForecastBench, underperforms market consensus, and improves the market forecast when combined with it. — [arXiv:2511.07678](https://arxiv.org/abs/2511.07678)
- An AI system topped all humans in the Summer 2026 Metaculus Cup. — [Reuters via The Star](https://www.thestar.com.my/tech/tech-news/2026/09/18/ai-startup-mantic-raises-25-million-for-superhuman-forecasting)
- LLM assistants raise human forecasting accuracy by 24–28%. — [arXiv:2402.07862](https://arxiv.org/abs/2402.07862)

### Inferences (how to use it; these are design suggestions, not documented practice)
- **What works now:**
  - LLM reading and scoring of policymaker text at scale (speeches, statements, votes, hearings).
  - AI event-probability forecasts as an extra, diversifying signal blended with market prices, not used alone.
  - AI assistants that make human analysts faster and more accurate.
- **What partly works:**
  - Persona agents for predicting individual votes in rule-bound bodies (FOMC, legislatures), which perform well on routine decisions.
  - Committee simulators for scenario analysis: how would a reconstituted committee or a newly appointed member shift the distribution of outcomes?
- **What does not yet work reliably:**
  - Predicting surprises: big unanticipated moves, narrow technical rulings, defections.
  - Simulating named heads of state in crises.
  - Synthetic electorates replacing polls (Aaru's 2024 miss).
- **Practical blueprint for a policy-intelligence product:**
  1. Build each actor's persona from their own public record (speeches, votes, opinions, interviews), in the spirit of Park et al.'s grounding. Use retrieval or fine-tuning to stop RLHF drift toward neutrality.
  2. Use point-in-time data and, ideally, chronologically consistent models for any backtest. Report pre- and post-cutoff performance separately.
  3. Benchmark against strong classical baselines: market pricing or futures for central banks, party line or ideal points for legislatures, Martin–Quinn scores for courts.
  4. Calibrate the output probabilities and ensemble across models and prompts, since model choice alone shifts behaviour.
  5. Keep a public, pre-registered live track record.
  6. Keep inputs to public information to stay clear of MNPI and political-intelligence risk.

### Gaps
- No public evidence shows that persona-agent simulations generate trading alpha beyond market-implied probabilities.

---

## Q11. Annotated, verified reading list (peer-reviewed vs preprints/working papers vs industry and press)

### Takeaway
Below, each source has authors, year, title, venue and a checked link. Identifiers were verified this session via the arXiv API, Crossref, or the ACL Anthology, NBER and BIS pages. ★ marks the core bridge readings between "how funds predict policy" and "simulating individuals."

### Cited Findings

#### A. Peer-reviewed (journals, main conferences, verified)
- ★ Bakhtin, Brown, Dinan et al. (Meta FAIR Diplomacy Team), 2022. "Human-level play in the game of Diplomacy by combining language models with strategic reasoning." *Science* 378(6624):1067–1074. A negotiating AI agent at human level. — [DOI 10.1126/science.ade9097](https://doi.org/10.1126/science.ade9097)
- Clinton, Jackman & Rivers, 2004. "The Statistical Analysis of Roll Call Data." *APSR* 98(2):355–370. The ideal-point baseline. — [DOI](https://doi.org/10.1017/S0003055404001194)
- Martin & Quinn, 2002. "Dynamic Ideal Point Estimation via MCMC for the U.S. Supreme Court, 1953–1999." *Political Analysis* 10(2). Justice ideology scores. — [DOI 10.1093/pan/10.2.134](https://doi.org/10.1093/pan/10.2.134)
- Ruger, Kim, Martin & Quinn, 2004. "The Supreme Court Forecasting Project…" *Columbia Law Review* 104(4). A statistical model vs legal experts. — [DOI 10.2307/4099370](https://doi.org/10.2307/4099370)
- Gerrish & Blei, 2011. "Predicting Legislative Roll Calls from Text." *ICML 2011*. Predicts votes on new bills from their text. — [PDF](https://icml.cc/imls/conferences/2011/papers/333_icmlpaper.pdf)
- Gerrish & Blei, 2012. "How They Vote: Issue-Adjusted Models of Legislative Behavior." *NIPS 2012*. — [PDF](https://www.cs.columbia.edu/~blei/papers/GerrishBlei2012.pdf)
- Yano, Smith & Wilkerson, 2012. "Textual Predictors of Bill Survival in Congressional Committees." *NAACL-HLT 2012*. — [ACL N12-1097](https://aclanthology.org/N12-1097/)
- Kraft, Jain & Rush, 2016. "An Embedding Model for Predicting Roll-Call Votes." *EMNLP 2016*. — [DOI 10.18653/v1/D16-1221](https://doi.org/10.18653/v1/D16-1221)
- Aletras, Tsarapatsanis, Preoţiuc-Pietro & Lampos, 2016. "Predicting judicial decisions of the European Court of Human Rights: an NLP perspective." *PeerJ Computer Science* 2:e93. — [DOI](https://doi.org/10.7717/peerj-cs.93)
- ★ Katz, Bommarito & Blackman, 2017. "A general approach for predicting the behavior of the Supreme Court of the United States." *PLOS ONE* 12(4):e0174698. About 70% accuracy with a random forest. — [DOI](https://doi.org/10.1371/journal.pone.0174698)
- Nay, 2017. "Predicting and understanding law-making with word vectors and an ensemble model." *PLOS ONE* 12(5):e0176999. — [DOI](https://doi.org/10.1371/journal.pone.0176999)
- Hansen, McMahon & Prat, 2018. "Transparency and Deliberation within the FOMC: A Computational Linguistics Approach." *QJE* 133(2):801–870. — [DOI](https://doi.org/10.1093/qje/qjx045)
- Kornilova, Argyle & Eidelman, 2018. "Party Matters: Enhancing Legislative Embeddings with Author Attributes for Vote Prediction." *ACL 2018*. — [DOI 10.18653/v1/P18-2081](https://doi.org/10.18653/v1/P18-2081)
- Chalkidis, Androutsopoulos & Aletras, 2019. "Neural Legal Judgment Prediction in English." *ACL 2019* (short). — [arXiv:1906.02059](https://arxiv.org/abs/1906.02059)
- Medvedeva, Vols & Wieling, 2020. "Using machine learning to predict decisions of the European Court of Human Rights." *Artificial Intelligence and Law* 28(2):237–266. — [DOI](https://doi.org/10.1007/s10506-019-09255-y)
- ★ Vafa, Naidu & Blei, 2020. "Text-Based Ideal Points." *ACL 2020*. Political positions from text alone. — [DOI](https://doi.org/10.18653/v1/2020.acl-main.475)
- Zou et al., 2022. "Forecasting Future World Events with Neural Networks" (Autocast). *NeurIPS 2022* (Datasets & Benchmarks). — [arXiv:2206.15474](https://arxiv.org/abs/2206.15474)
- ★ Argyle, Busby, Fulda, Gubler, Rytting & Wingate, 2023. "Out of One, Many: Using Language Models to Simulate Human Samples." *Political Analysis* 31(3):337–351. — [DOI](https://doi.org/10.1017/pan.2023.2)
- Gorodnichenko, Pham & Talavera, 2023. "The Voice of Monetary Policy." *AER* 113(2):548–584. — [DOI](https://doi.org/10.1257/aer.20220129)
- Shah, Paturi & Chava, 2023. "Trillion Dollar Words: A New Financial Dataset, Task & Market Analysis." *ACL 2023*. FOMC hawk/dove data. — [DOI](https://doi.org/10.18653/v1/2023.acl-long.368)
- ★ Peskoff, Visokay, Schulhoff, Wachspress, Blinder & Stewart, 2023. "GPT Deciphering Fedspeak: Quantifying Dissent Among Hawks and Doves." *Findings of EMNLP 2023*. — [DOI](https://doi.org/10.18653/v1/2023.findings-emnlp.434)
- Cheng, Piccardi & Yang, 2023. "CoMPosT: Characterizing and Evaluating Caricature in LLM Simulations." *EMNLP 2023*. — [arXiv:2310.11501](https://arxiv.org/abs/2310.11501)
- ★ Bisbee, Clinton, Dorff, Kenkel & Larson, 2024. "Synthetic Replacements for Human Survey Data? The Perils of Large Language Models." *Political Analysis* 32(4):401–416. — [DOI](https://doi.org/10.1017/pan.2024.5)
- ★ Rivera, Mukobi, Reuel, Lamparth, Smith & Schneider, 2024. "Escalation Risks from Language Models in Military and Diplomatic Decision-Making." *ACM FAccT 2024*, pp. 836–898. — [DOI](https://doi.org/10.1145/3630106.3658942)
- ★ Lamparth, Corso, Ganz, Mastro, Schneider & Trinkunas, 2024. "Human vs. Machine: Behavioral Differences Between Expert Humans and Language Models in Wargame Simulations." *AIES 2024*. — [DOI](https://doi.org/10.1609/aies.v7i1.31681)
- ★ Halawi, Zhang, Yueh-Han & Steinhardt, 2024. "Approaching Human-Level Forecasting with Language Models." *NeurIPS 2024*. — [DOI 10.52202/079017-1598](https://doi.org/10.52202/079017-1598); [arXiv](https://arxiv.org/abs/2402.18563)
- ★ Schoenegger, Tuminauskaite, Park, Bastos & Tetlock, 2024. "Wisdom of the silicon crowd: LLM ensemble prediction capabilities rival human crowd accuracy." *Science Advances* 10(45):eadp1528. — [DOI](https://doi.org/10.1126/sciadv.adp1528)
- Drinkall, Rahimikia, Pierrehumbert & Zohren, 2024. "Time Machine GPT." *Findings of NAACL 2024*. — [arXiv:2404.18543](https://arxiv.org/abs/2404.18543)
- ★ Li, Gong & Jiang, 2025. "Political Actor Agent: Simulating Legislative System for Roll Call Votes Prediction with LLMs." *AAAI 2025*. — [DOI](https://doi.org/10.1609/aaai.v39i1.32017)
- Wang, Morgenstern & Dickerson, 2025. "Large language models that replace human participants can harmfully misportray and flatten identity groups." *Nature Machine Intelligence* 7(3):400–411. — [DOI](https://doi.org/10.1038/s42256-025-00986-z)
- ★ Kreutner, Lutz & Strohmaier, 2026. "Persona-driven Simulation of Voting Behavior in the European Parliament with LLMs." *Findings of EACL 2026*. — [DOI](https://doi.org/10.18653/v1/2026.findings-eacl.25)
- Koniaris, Tsipi & Tsanakas, 2026. "ParliaBench: An Evaluation and Benchmarking Framework for LLM-Generated Parliamentary Speech." *LREC 2026*. — [arXiv:2511.08247](https://arxiv.org/abs/2511.08247)

#### B. Workshop papers (lighter review)
- Hamilton, 2023. "Blind Judgement: Agent-Based Supreme Court Modelling With GPT." AAAI-23 Creative AI workshop. — [arXiv:2301.05327](https://arxiv.org/abs/2301.05327)
- Hou et al., 2025. "FedSight AI: Multi-Agent System Architecture for Federal Funds Target Rate Prediction." NeurIPS 2025 GenAI in Finance workshop. — [arXiv:2512.15728](https://arxiv.org/abs/2512.15728)
- Van Mulders, Bogaert & Van den Poel, 2026. "Digital Pantheon: Simulating and Auditing Coalition Formation with LLM Agents." ECML PKDD 2026 AIDEM workshop. — [arXiv:2607.15095](https://arxiv.org/abs/2607.15095)

#### C. Preprints and working papers (not confirmed peer-reviewed)
- ★ Kazinnik & Sinclair, 2025/2026. "FOMC In Silico: A Multi-Agent System for Monetary Policy Decision Modeling." Working paper (Stanford DEL; NBER conference version 16 Jul 2026). The leading central-bank persona simulation. — [NBER PDF](https://conference.nber.org/conf_papers/f244384.pdf)
- Seok, Wen, Yang, Feng & Yang, 2024. "MiniFed: Integrating LLM-based Agentic-Workflow for Simulating FOMC Meeting." arXiv. — [arXiv:2410.18012](https://arxiv.org/abs/2410.18012)
- ★ Hansen & Kazinnik, 2023/2024. "Can ChatGPT Decipher Fedspeak?" SSRN / Richmond Fed working paper. — [FRBSF/Richmond Fed](https://www.frbsf.org/research-and-insights/publications/system-research-richmond-fed/can-chatgpt-decipher-fedspeak/)
- Aruoba & Drechsel. "Identifying Monetary Policy Shocks: A Natural Language Approach." NBER WP 32417. — [NBER](https://www.nber.org/papers/w32417)
- Gambacorta et al., 2024. "CB-LMs: language models for central banking." BIS WP 1215. — [BIS](https://www.bis.org/publ/work1215.htm)
- Hansen, Horton, Kazinnik, Puzzello & Zarifhonarvar. "Simulating the Survey of Professional Forecasters." SSRN. — [DOI 10.2139/ssrn.5066286](https://doi.org/10.2139/ssrn.5066286)
- Baker & Azher, 2024. "Simulating The U.S. Senate: An LLM-Driven Agent Approach to Modeling Legislative Behavior and Bipartisanship." arXiv. — [arXiv:2406.18702](https://arxiv.org/abs/2406.18702)
- ★ Wu, Nagler, Tucker & Messing, 2023. "Large Language Models Can Be Used to Estimate the Latent Positions of Politicians." arXiv. — [arXiv:2303.12057](https://arxiv.org/abs/2303.12057)
- O'Hagan & Schein, 2023. "Measurement in the Age of LLMs: An Application to Ideological Scaling." arXiv. — [arXiv:2312.09203](https://arxiv.org/abs/2312.09203)
- Li et al., 2024. "Political-LLM: Large Language Models in Political Science." arXiv survey. — [arXiv:2412.06864](https://arxiv.org/abs/2412.06864)
- ★ Stillwell & Harrington, 2026. "Predicting the Court: Evaluating Large Language Models as Forecasters of Supreme Court Decisions." SSRN (10 Jul 2026). — [abstract via beSpacific](https://www.bespacific.com/?p=126584)
- Aldahoul, Ibrahim, Kaufman, Rahwan & Zaki, 2025. "The Political Ideology of Large Language Models…" arXiv. — [arXiv:2505.04171](https://arxiv.org/abs/2505.04171)
- Hua et al., 2023. "War and Peace (WarAgent): LLM-based Multi-Agent Simulation of World Wars." arXiv. — [arXiv:2311.17227](https://arxiv.org/abs/2311.17227)
- Mukobi et al., 2023. "Welfare Diplomacy: Benchmarking Language Model Cooperation." arXiv. — [arXiv:2310.08901](https://arxiv.org/abs/2310.08901)
- Hogan & Brennen, 2024. "Open-Ended Wargames with Large Language Models." arXiv. — [arXiv:2404.11446](https://arxiv.org/abs/2404.11446)
- Jensen, Reynolds, Atalan, Garcia, Woo et al., 2025. "Critical Foreign Policy Decisions (CFPD)-Benchmark." arXiv. — [arXiv:2503.06263](https://arxiv.org/abs/2503.06263)
- Solopova et al., 2026. "LLMs as Strategic Actors: Behavioral Alignment, Risk Calibration, and Argumentation Framing in Geopolitical Simulations." arXiv. — [arXiv:2603.02128](https://arxiv.org/abs/2603.02128)
- ★ Karger, Bastani, Yueh-Han, Jacobs, Halawi, Zhang et al., 2024. "ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities." arXiv (reported as ICLR 2025; not verified here). — [arXiv:2409.19839](https://arxiv.org/abs/2409.19839)
- Schoenegger, Park, Karger, Trott & Tetlock, 2024. "AI-Augmented Predictions: LLM Assistants Improve Human Forecasting Accuracy." arXiv. — [arXiv:2402.07862](https://arxiv.org/abs/2402.07862)
- Pratt, Blumberg, Carolino & Morris, 2024. "Can Language Models Use Forecasting Strategies?" arXiv. — [arXiv:2406.04446](https://arxiv.org/abs/2406.04446)
- Paleka et al., 2024. "Consistency Checks for Language Model Forecasters." arXiv (ICLR 2025 submission). — [arXiv:2412.18544](https://arxiv.org/abs/2412.18544)
- Ye et al., 2024. "MIRAI: Evaluating LLM Agents for Event Forecasting." arXiv. — [arXiv:2407.01231](https://arxiv.org/abs/2407.01231)
- Zeng et al., 2025. "FutureX: An Advanced Live Benchmark for LLM Agents in Future Prediction." arXiv. — [arXiv:2508.11987](https://arxiv.org/abs/2508.11987)
- FutureSearch (Wildman, Bosse et al.), 2025. "Bench to the Future: A Pastcasting Benchmark for Forecasting Agents." arXiv. — [arXiv:2506.21558](https://arxiv.org/abs/2506.21558)
- Turtel, Franklin, Skotheim, Hewitt & Schoenegger, 2025. "Outcome-based Reinforcement Learning to Predict the Future." arXiv. — [arXiv:2505.17989](https://arxiv.org/abs/2505.17989)
- ★ Alur, Stadie, Kang, … Sekhon (Bridgewater AIA Labs), 2025. "AIA Forecaster: Technical Report." arXiv. — [arXiv:2511.07678](https://arxiv.org/abs/2511.07678)
- ★ Paleka, Goel, Geiping & Tramèr, 2025. "Pitfalls in Evaluating Language Model Forecasters." arXiv. — [arXiv:2506.00723](https://arxiv.org/abs/2506.00723)
- ★ Lopez-Lira, Tang & Zhu, 2025. "The Memorization Problem: Can We Trust LLMs' Economic Forecasts?" arXiv. — [arXiv:2504.14765](https://arxiv.org/abs/2504.14765)
- He, Lv, Manela & Wu, 2025. "Chronologically Consistent Large Language Models." arXiv. — [arXiv:2502.21206](https://arxiv.org/abs/2502.21206)
- Glasserman & Lin, 2023. "Assessing Look-Ahead Bias in Stock Return Predictions Generated by GPT Sentiment Analysis." arXiv. — [arXiv:2309.17322](https://arxiv.org/abs/2309.17322)
- Sarkar & Vafa, 2024. "Lookahead Bias in Pretrained Language Models." SSRN. — [DOI 10.2139/ssrn.4754678](https://doi.org/10.2139/ssrn.4754678)
- Sharma et al., 2023. "Towards Understanding Sycophancy in Language Models." arXiv. — [arXiv:2310.13548](https://arxiv.org/abs/2310.13548)
- Santurkar et al., 2023. "Whose Opinions Do Language Models Reflect?" arXiv. — [arXiv:2303.17548](https://arxiv.org/abs/2303.17548)
- Kim & Lee, 2023. "AI-Augmented Surveys…" arXiv. — [arXiv:2305.09620](https://arxiv.org/abs/2305.09620)
- Jiang, Wei & Zhang, 2024. "Donald Trumps in the Virtual Polls…" arXiv. — [arXiv:2411.01582](https://arxiv.org/abs/2411.01582)
- Zhang et al., 2024. "ElectionSim: Massive Population Election Simulation Powered by LLM Driven Agents." arXiv. — [arXiv:2410.20746](https://arxiv.org/abs/2410.20746)
- Ashokkumar, Hewitt, Ghezae & Willer. "Large language models can predict the results of social science experiments." OSF preprint. — [DOI](https://doi.org/10.31234/osf.io/3svep_v1)
- Wu et al. (Bloomberg), 2023. "BloombergGPT: A Large Language Model for Finance." arXiv. — [arXiv:2303.17564](https://arxiv.org/abs/2303.17564)
- Anchor paper: Park, Zou, Kamphorst, Egan, Shaw, Hill et al., 2024/2025. "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals." arXiv v3 (Nature version not verified by me; covered by another researcher). — [arXiv:2411.10109](https://arxiv.org/abs/2411.10109)

#### D. Industry, benchmark-operator and press sources (not academic; dated)
- FRI ForecastBench updates (Oct 2025; 29 Jan 2026). — [Oct 2025](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark); [Jan 2026](https://forecastingresearch.substack.com/p/llms-are-closing-the-gap-on-human)
- Lightning Rod Labs (8 Jul 2026, interested party): AI forecasters statistically indistinguishable from superforecasters. — [blog](https://blog.lightningrod.ai/p/ai-reaches-human-superforecaster-range)
- Metaculus AI benchmark write-ups: Q1 2025, Q2 2025, and "FutureEval Spring." — [Q1](https://www.lesswrong.com/posts/rDy5z8ZEtMrEGnfBd/q1-ai-benchmark-results-pro-forecasters-crush-bots); [Q2](https://www.lesswrong.com/posts/Surnjh8A4WjgtQTkZ/q2-ai-benchmark-results-pros-maintain-clear-lead); [FutureEval Spring](https://www.lesswrong.com/posts/wZBbDqzfBjYG58CxK/futureeval-spring-results-pros-beat-bots-but-the-gap-is)
- Reuters (18 Sep 2026), on Mantic topping the Summer 2026 Metaculus Cup and its $25M seed round. — [via The Star](https://www.thestar.com.my/tech/tech-news/2026/09/18/ai-startup-mantic-raises-25-million-for-superhuman-forecasting)
- BNN Bloomberg (26 Apr 2023), JPMorgan Hawk-Dove score. — [link](https://www.bnnbloomberg.ca/jpmorgan-s-ai-puts-25-years-of-fed-speeches-into-a-hawk-dove-score-1.1912721)
- Bloomberg (14 Aug 2024), hedge funds and ChatGPT, including Balyasny's central-bank previews. — [link](https://www.bloomberg.com/news/articles/2024-08-14/hedge-funds-battle-to-turn-chatgpt-from-intern-to-analyst)
- Business Insider (Nov 2023), Bridgewater AIA Lab. — [link](https://www.businessinsider.nl/bridgewater-building-ai-fund-machine-learning-greg-jensen-2023-11)
- Man Group (Nov 2025), AlphaGPT, plus Hedgeweek coverage. — [Man](https://www.man.com/insights/what-ai-can-do-for-alpha); [Hedgeweek](https://hedgeweek.com/news/man-group-deploys-agentic-ai-for-quant-signal-discovery)
- Hedgeweek and Bloomberg Government (Oct 2025), Griffin on GenAI and alpha. — [Hedgeweek](https://www.hedgeweek.com/generative-ai-fails-to-deliver-alpha-for-hedge-funds-says-griffin/)
- Semafor (Sep–Nov 2024), Aaru's AI polling and its 2024 miss. — [link](https://semafor.com/article/11/04/2024/an-ai-polling-startup-polls-bots-predicts-harris-will-win)
- GAO 2013 political-intelligence report, via law-firm summary. — [Akin Gump](https://www.akingump.com/en/news-insights/stock-act-required-gao-report-on-political-intelligence.html)

### Inferences
- The most useful sequence for a newcomer:
  1. Katz et al. 2017 and Vafa et al. 2020, for classic prediction.
  2. Argyle et al. 2023 → Bisbee et al. 2024, for the simulation debate.
  3. Kazinnik & Sinclair 2026, PAA 2025 and Kreutner et al. 2026, for persona agents.
  4. Halawi et al. 2024 → ForecastBench → AIA Forecaster 2025, for forecasting.
  5. Lopez-Lira et al. 2025, Paleka et al. 2025 and Stillwell & Harrington 2026, for the cautions.

### Gaps
- Venue status for ForecastBench (ICLR 2025?), Paleka et al. "Consistency Checks" (ICLR 2025?), MIRAI, WarAgent and Schoenegger et al. "AI-Augmented Predictions" may have changed since the arXiv versions; I did not confirm peer-reviewed publication for them.
- The SSRN pages for Stillwell & Harrington and Hansen & Kazinnik returned 403 or were not reachable directly; their existence is confirmed through secondary listings (beSpacific, FRBSF/Richmond Fed).
