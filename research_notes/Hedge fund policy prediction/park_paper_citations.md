# Park et al., "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals": what it did and found, what it cites, and related work (2024–2026)

Notes compiled 2026-10-15. Primary source: the Nature-formatted manuscript PDF ([PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf); PDF metadata title "[Nature] Main Manuscript.docx", 15 pages, 66 references). I compared it with arXiv v1 ([arXiv:2411.10109v1](https://arxiv.org/abs/2411.10109v1), Nov 2024, "Generative Agent Simulations of 1,000 People") and arXiv v3 ([arXiv:2411.10109v3](https://arxiv.org/abs/2411.10109v3), updated 28 Jun 2026, which carries the new title). I checked every bibliographic entry below against Crossref (DOIs) or the arXiv API (arXiv IDs) unless it is marked "not verified". To find forward citations I used Firecrawl's research citation graph ("citers" mode on arXiv:2411.10109 returned 120 citing papers) plus targeted searches. Semantic Scholar and OpenAlex returned rate-limit errors during this session.

Tag legend: **[POLICY]** marks a work most relevant to using simulated agents to predict policy decisions or reactions to policy.

---

## Q1. What did the paper do, what did it measure, and what did it find?

### Takeaway
The authors built LLM "generative agents" for 1,052 real Americans, one agent per person, from that person's own self-reports: a 2-hour AI-run interview, survey answers (GSS + Big Five), or both. They then checked how well each agent predicted its person's answers on held-out questions. On held-out General Social Survey (GSS) items, the agents matched people 83% (interview only), 82% (surveys only) and 86% (both) as well as people matched their own answers two weeks later. Agents given only demographics reached 74%. Rich self-report grounding also narrowed accuracy gaps across political and racial groups. Agent-predicted experimental effects were highly correlated with the human effects but much larger.

### Cited Findings
**Design and sample**
- Sample: N = 1,052 US adults, recruited through the firm Bovitz and stratified to approximate US distributions on age, gender, race, region, education and party identification. The methods summary lists the stratification as age, census division, education, ethnicity, gender, income, neighborhood, political ideology and sexual orientation. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- Each participant did a voice-to-voice interview in English with an **AI interviewer**: about 2 hours on average, with transcripts averaging 6,491 words (SD 2,541). The interview followed the **American Voices Project** protocol (Stanford Center on Poverty and Inequality), a mix of fixed life-story and social-issue questions plus follow-ups the AI generated adaptively. The authors chose an existing protocol so the interview would not be tailored to their evaluation tasks. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- After the interview, participants completed four instruments: the GSS core module, the 44-item Big Five Inventory (BFI-44), five incentivized economic games, and five experiments taken from the Mechanical Turk Replication Project. The five games were the dictator game, trust game (player 1 and player 2), public goods game and prisoner's dilemma. Participants repeated all four instruments **two weeks later** to measure their own test-retest consistency. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- Incentives (from v1 supplementary material): $60 for phase 1, $30 for phase 2, and a $0–10 bonus. Game stakes were a $5 dictator split, a $3 trust endowment (tripled when sent), a $4 public-goods endowment, and prisoner's dilemma payoffs of $6/$8/$2/$4. — [arXiv v1 PDF](https://arxiv.org/pdf/2411.10109v1)
- The five experiments were Ames & Fiske 2015 (perceived intent and harm), Cooney et al. 2016 (fairness), Halevy & Halali 2015 (third-party peacemakers), Rai et al. 2017 (dehumanization) and Schilke et al. 2015 (power and trust). They were chosen because each could be described in text and was adequately powered with about 1,000 people. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)

**Agent types compared**
- There were five agent types:
  1. "Interview agents": the full transcript is injected into the prompt.
  2. "Survey agents": GSS + Big Five answers, with the evaluated GSS item held out, and for the Big Five, every item in the same category held out.
  3. "Survey-plus-interview" agents.
  4. "Demographic" baseline: age, gender, race and political ideology only.
  5. "Persona" baseline: a short paragraph each participant wrote about themselves.

  — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- The metrics and core analyses for the interview, demographic and persona agents were pre-registered on OSF. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- v1 says the AI interviewer and the interview-summary step used OpenAI GPT-4o. v1's agents also had an "expert reflection" module, in which the model wrote notes on each participant from the viewpoint of a psychologist, behavioral economist, political scientist and demographer. — [arXiv v1 PDF](https://arxiv.org/pdf/2411.10109v1)

**Key metric: "normalized accuracy"**
- Normalized accuracy = the agent's accuracy at predicting the person's wave-2 answers ÷ how well the person's wave-2 answers match their own wave-1 answers. A score of 1.0 means "the agent predicts you as well as you predict yourself two weeks later." For continuous outcomes (Big Five, games) the same idea is applied to correlations ("normalized correlation"). — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)

**Results**
- **GSS** (150 core items, 3.31 response options on average, chance ≈ 0.30):

  | Agent type | Normalized accuracy | Notes |
  |---|---|---|
  | Interview | 0.83 (SD 0.11) | raw accuracy 65.67% ÷ participants' self-consistency 79.53% |
  | Survey | 0.82 | |
  | Survey + interview | 0.86 | |
  | Demographic | 0.74 | |
  | Persona | 0.71 | |

  ANOVA: the three grounded agent types significantly beat both baselines. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Big Five** (normalized correlation): interview 0.80 (raw r = 0.78 ÷ retest r = 0.95), survey 0.65, survey + interview 0.77, demographic 0.61, persona 0.75. Mean absolute error (MAE) was lowest for survey (0.622) and survey + interview (0.621) and higher for interview (0.665), demographic (0.755) and persona (0.737). — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Economic games** (normalized correlation): interview 0.66, survey 0.38, survey + interview 0.49. MAE did not differ significantly between agents (F(2, 3153) = 0.12, p = 0.89). — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Ablations**:
  - Randomly deleting 80% of each transcript (about 96 of 120 minutes) still gave GSS 0.79 and Big Five 0.73.
  - "Interview-summary" agents (bullet-point summaries with the original wording removed) scored GSS 0.84 and Big Five 0.70.

  So the gains come mainly from the information in the interview, not its exact wording. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Experiments (population level)**:
  - Agent-estimated effect sizes correlated with the human replication's effect sizes at r = 0.91–0.99 across agent types (interview r = 0.98, 95% CI [0.75, 1.00]).
  - Agent effect sizes were **larger** than the human ones. For example, Cohen's d for Schilke et al. was 0.36 for humans vs 2.97 for interview agents, and for Cooney et al. 0.40 vs 1.34.
  - The authors call the five-study design "underpowered" for comparing effect sizes.
  - The human replication did not find a significant effect for Rai et al. (d = 0.06), but demographic agents (p < .001) and survey agents (p < .05) did.

  — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Bias/fairness** was measured with the Demographic Parity Difference (DPD): the accuracy gap between the best- and worst-predicted subgroup.
  - Political ideology:
    - GSS: DPD fell from 13.75% (demographic agents) to 8.60% (interview), 6.22% (survey) and 7.09% (combined).
    - Big Five: 0.166 (demographic) to 0.063 (interview) and 0.048 (combined); survey agents were 0.176.
    - Economic games: 0.498 (demographic) to 0.194 (interview).
  - Race, GSS: 3.39% (demographic) to 2.22% (interview) and 1.95% (survey).
  - Gender gaps were small (typically under 1%) for every agent type.

  — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Mechanism analysis** (new in the Nature version): GPT-4o-mini classified about 21,713 interview-answer × GSS-question pairs per agent as either "directly retrievable" or "answerable by inference".
  - Dropping the 100 GSS items most likely to be directly retrievable cut interview-agent accuracy from 0.83 to 0.80.
  - Dropping the 100 most "inferable" items cut it to 0.77.
  - Demographic and persona agents barely moved.
  - The authors conclude that both retrieval and inference contribute.

  — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Leakage control**: the authors screened all 54,694 possible GSS-item × interview-question pairs, first with a GPT classifier and then by human review. They removed 27 GSS items that near-duplicated interview questions. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Data access**: aggregated responses on the fixed tasks are open, and the agent-building code is open source. The individual interview-based agents are not public because of privacy. The GitHub README says individual-level access is "by request", subject to an ethics review. The public repo includes a bank of more than 3,000 demographic-only agents built from GSS data, plus code for building agents from your own data (MIT license). — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf); [GitHub genagents repo (joonspk-research/genagents, served as StanfordHCI/genagents)](https://github.com/joonspk-research/genagents)
- **Stated near-term uses** are research uses: heterogeneity analysis, measurement refinement, "mixed subjects" designs, and pilot-testing experimental designs. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Funders** acknowledged: Google, Toyota Research Institute, Ford, Stanford HAI, American Express, AXA, Banco Itaú, Hanwha, SCBX. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- Press coverage: Stanford HAI news story "AI Agents Simulate 1,052 Individuals' Personalities with Impressive Accuracy" — [Stanford HAI](https://hai.stanford.edu/news/ai-agents-simulate-1052-individuals-personalities-with-impressive-accuracy) (not read in full); Stanford project page — [AI4PB project page](https://ai4pb.stanford.edu/projects/generative-agent-simulations-of-1%2C000-people)

### Inferences
- The headline "85%" figure from 2024 media coverage is out of date. The current version reports 83% for interview-only agents and 86% for interview + survey agents, against a demographics-only baseline of 74%. The gain from rich grounding is about 9–12 normalized points on the GSS, smaller than the 14–15 points in v1.
- The test-retest denominator means "83%" does **not** mean the agent gets 83% of answers right. Raw GSS accuracy was about 66%, and people themselves agree with their own earlier answers only about 80% of the time.
- Agents get the **direction and ranking** of experimental effects right but **inflate their size**. The same pattern appears at much larger scale in Ashokkumar/Hewitt et al. (Nature 2026; see Q4). Anyone using agent-simulated effect sizes for forecasting should expect to shrink them.
- Economic-game behavior (real-money choices) is predicted far less well than survey attitudes, especially by survey-only agents (0.38). Behavior under incentives is harder to simulate than stated opinion.

### Gaps
- The Nature main text does not name the LLM that powers the agents. It mentions only GPT-4o-mini, for the mechanism classifier. v1 used GPT-4o. The model may be named in the supplementary materials, which I did not have.
- **Publication status:** I could not confirm that the paper has been published in Nature as of Oct 2026. The PDF is a manuscript formatted for Nature, and the arXiv v3 abstract (28 Jun 2026) carries the new title, but no Nature DOI turned up in searches. [arXiv v3](https://arxiv.org/abs/2411.10109v3); [WebSearch / Stanford AI4PB page lists it as working paper](https://ai4pb.stanford.edu/projects/generative-agent-simulations-of-1%2C000-people)
- I could not get a total citation count (Semantic Scholar and OpenAlex were rate-limited).

---

## Q2. Did the Nature version change anything compared with arXiv 2411.10109 v1?

### Takeaway
Yes. The substance changed, not just the title. The Nature version adds full-sample survey-only and survey-plus-interview agents. It drops the v1 claim that interviews beat surveys and instead shows interviews and surveys perform about the same (0.83 vs 0.82), with a modest gain from combining them (0.86). It removes 27 GSS items that overlapped with the interview, which lowers the headline from 0.85 to 0.83. It adds a retrieval-vs-inference mechanism analysis, reports agent effect-size inflation more openly, and tones down the claims about policymaking.

### Cited Findings
- **Title and authors**: v1 was "Generative Agent Simulations of 1,000 People" with 9 authors (Park, Zou, Shaw, Hill, Cai, Morris, Willer, Liang, Bernstein). The new version, "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals", adds **Jonne Kamphorst** (Sciences Po) and **Niles Egan**. — [arXiv v1](https://arxiv.org/abs/2411.10109v1); [arXiv v3](https://arxiv.org/abs/2411.10109v3)
- **Framing**:
  - v1 opened with "broad applications in policymaking and social science."
  - The new abstract frames the problem as ML needing outcome-specific training data, and LLM agents built on self-reports as a "general-purpose" alternative.
  - The near-term uses are now listed as research tools: heterogeneity analysis, mixed-subjects designs and pilot testing.

  — [arXiv v1](https://arxiv.org/abs/2411.10109v1); [arXiv v3](https://arxiv.org/abs/2411.10109v3); [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **GSS headline**: v1 reported 0.85 for interview agents (raw 68.85% ÷ 81.25%) on 177 GSS items, with demographic 0.71 and persona 0.70. The Nature version reports 0.83 (raw 65.67% ÷ 79.53%) on 150 items after removing the 27 interview-overlapping items, with demographic 0.74 and persona 0.71. — [arXiv v1 PDF](https://arxiv.org/pdf/2411.10109v1); [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Interviews vs. surveys, a reversal of emphasis**:
  - v1 compared interview agents with "composite" agents built from GSS + Big Five + game answers, on only 100 participants. The composite agents scored GSS 0.76, Big Five 0.64 and games 0.31, and v1 concluded that "interviews are more effective and efficient than survey-based methods."
  - The Nature version runs survey agents on the full sample: GSS 0.82, nearly equal to interview 0.83. Survey MAE on the Big Five is actually lower.
  - The new abstract says combining sources gives "modest" gains and that "predictive benefits from data begin to asymptote."

  — [arXiv v1 PDF](https://arxiv.org/pdf/2411.10109v1); [arXiv v3 abstract](https://arxiv.org/abs/2411.10109v3)
- **Experiments**:
  - v1 stressed that the agents replicated the same 4 of 5 studies as humans, with effect-size r = 0.98 and a "normalized correlation of 0.99."
  - The Nature version reports r = 0.91–0.99 across five agent types. It adds that agent effect sizes "were larger than" the human ones and that the design is "underpowered."

  — [arXiv v1 PDF](https://arxiv.org/pdf/2411.10109v1); [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **Bias (political ideology, GSS)**: v1 reported DPD of 12.35% (demographic) vs 7.85% (interview). The Nature version reports 13.75% vs 8.60%, with survey at 6.22% and combined at 7.09%. — [arXiv v1 PDF](https://arxiv.org/pdf/2411.10109v1); [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **New sections**: the retrieval-vs-inference mechanism analysis and the systematic 54,694-pair leakage screen. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)
- **New references** (2024–2025 literature): Toubia et al. Twin-2K-500; Verhagen et al. Book of Life; Cui et al. (Nat Comput Sci 2025); Anthis et al. 2025; Lundberg et al. 2024; Broska et al.; Boelaert et al.; Qu & Wang; Li et al. 2024 (Marketing Science); Binz & Schulz 2023; Wang/Morgenstern/Dickerson. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)

### Inferences
- The version change matters for anyone deciding how to build agents. The newer evidence says a well-chosen structured survey battery about the person gets you nearly as far as a 2-hour interview. That is useful because interviews are expensive, and for elite policymakers impossible.

### Gaps
- I did not compare the supplementary materials of the two versions, so changes to the prompts or agent architecture (for example, whether "expert reflection" was kept) are unconfirmed.
- I did not inspect arXiv v2 separately.

---

## Q3. What does the paper cite? Annotated reading list A, grouped by theme (the Nature manuscript's 66 references)

### Takeaway
The reference list has six clusters:
1. LLM-as-human-proxy work (Argyle, Horton, Santurkar, Ashokkumar/Hewitt, Toubia).
2. Critiques about stereotyping and flattening (Wang et al., Cheng et al., Messeri & Crockett, Qu & Wang, Boelaert et al.).
3. ML prediction of life outcomes (Salganik, Lundberg).
4. The measurement instruments themselves: GSS, BFI-44, the classic economic games, and the five PNAS experiments from the MTurk Replication Project.
5. Classic agent-based modeling (Schelling, Epstein & Axtell, Bonabeau, Macy & Willer).
6. Fairness metrics (Hardt et al.).

Notably, it does **not** cite Aher et al. 2023, Dillion et al. 2023, Bisbee et al. 2024, or the Open Science Collaboration / Camerer et al. 2018 replication papers. Neither did v1. Those works are in list B.

### Cited Findings
Citations below are verified against Crossref or arXiv unless marked otherwise. Reference numbers [n] are from the Nature manuscript ([PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)).

**A1. Generative agents and the authors' own agent architectures**
- [10] Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P., Bernstein, M.S. (2023). "Generative Agents: Interactive Simulacra of Human Behavior." *UIST '23* (ACM), 1–22. — [doi:10.1145/3586183.3606763](https://doi.org/10.1145/3586183.3606763). This is the "Smallville" paper that introduced the memory–reflection–planning agent architecture the present paper builds on.
- [31] Park, J.S., Popowski, L., Cai, C., Morris, M.R., Liang, P., Bernstein, M.S. (2022). "Social Simulacra: Creating Populated Prototypes for Social Computing Systems." *UIST '22*, 1–18. — [doi:10.1145/3526113.3545616](https://doi.org/10.1145/3526113.3545616). This is the earlier persona-based simulation work, and the source of the "persona" baseline.

**A2. LLMs as simulated respondents and subjects ("silicon samples")**
- [2] Argyle, L.P., Busby, E.C., Fulda, N., Gubler, J.R., Rytting, C., Wingate, D. (2023). "Out of One, Many: Using Language Models to Simulate Human Samples." *Political Analysis* 31, 337–351. — [doi:10.1017/pan.2023.2](https://doi.org/10.1017/pan.2023.2). The founding "silicon sampling" paper: demographic backstories reproduce group-level vote choice and attitudes. It is the template for the paper's demographic baseline. **[POLICY]** (voters)
- [50] Horton, J.J. (2023). "Large Language Models as Simulated Economic Agents: What Can We Learn from Homo Silicus?" arXiv (later versions co-authored with A. Filippas & B.S. Manning). — [arXiv:2301.07543](https://arxiv.org/abs/2301.07543). Shows LLMs reproduce classic behavioral-economics results and introduced the term "homo silicus".
- [35] Santurkar, S., Durmus, E., Ladhak, F., Lee, C., Liang, P., Hashimoto, T. (2023). "Whose Opinions Do Language Models Reflect?" *ICML 2023*. — [arXiv:2303.17548](https://arxiv.org/abs/2303.17548). The OpinionQA benchmark: default LLM opinions are misaligned with many US demographic groups.
- [1] Ashokkumar, A., Hewitt, L., Ghezae, I., Willer, R. Cited as a 2024 preprint, "Predicting Results of Social Science Experiments Using Large Language Models." **Now published** as "Large language models can predict the results of social science experiments," *Nature* 656, 115–122 (2026). — [doi:10.1038/s41586-026-10742-x](https://doi.org/10.1038/s41586-026-10742-x). GPT-4 predictions of the treatment effects in 70 preregistered US survey experiments (469 effects, 119,330 participants) correlate strongly with the actual effects but systematically overestimate effect sizes ([Stanford GSB summary](https://www.gsb.stanford.edu/faculty-research/publications/large-language-models-can-predict-results-social-science-experiments)). **[POLICY]** (message and policy-framing experiments)
- [3] Toubia, O., Gui, G.Z., Peng, T., Merlau, D.J., Li, A., Chen, H. (2025). "Twin-2K-500: A Data Set for Building Digital Twins of over 2,000 People Based on Their Answers to over 500 Questions." *Marketing Science* 44, 1446–1455. — [doi:10.1287/mksc.2025.0262](https://doi.org/10.1287/mksc.2025.0262); [arXiv:2505.17479](https://arxiv.org/abs/2505.17479). A public individual-level dataset (N = 2,058, 4 waves, test-retest wave) and the main open benchmark for "digital twins."
- [5] Li, P., Castelo, N., Katona, Z., Sarvary, M. (2024). "Frontiers: Determining the Validity of Large Language Models for Automated Perceptual Analysis." *Marketing Science* 43, 254–266. — [doi:10.1287/mksc.2023.0454](https://doi.org/10.1287/mksc.2023.0454). LLMs reproduce consumer perceptual maps, a marketing-side validation.
- [6] Binz, M., Schulz, E. (2023). "Using cognitive psychology to understand GPT-3." *PNAS* 120(6), e2218523120. — [doi:10.1073/pnas.2218523120](https://doi.org/10.1073/pnas.2218523120). Ran classic cognitive-psychology tasks on GPT-3 and is the precursor to Centaur.
- [7] Cui, Z., Li, N., Zhou, H. (2025). "A large-scale replication of scenario-based experiments in psychology and management using large language models." *Nature Computational Science* 5, 627–634. — [doi:10.1038/s43588-025-00840-7](https://doi.org/10.1038/s43588-025-00840-7). LLMs replicate many vignette experiments at scale, with failures for some designs.
- [8] Anthis, J.R., Liu, R., Richardson, S.M., Kozlowski, A.C., Koch, B., Evans, J., Brynjolfsson, E., Bernstein, M. (2025). "LLM Social Simulations Are a Promising Research Method" (position paper). — [arXiv:2504.02234](https://arxiv.org/abs/2504.02234). Lays out five challenges (diversity, bias, sycophancy, alienness, generalization) and a research agenda. Co-authored by Bernstein.
- [12] Qu, Y., Wang, J. (2024). "Performance and biases of Large Language Models in public opinion simulation." *Humanities and Social Sciences Communications* 11, 1095. — [doi:10.1057/s41599-024-03609-x](https://doi.org/10.1057/s41599-024-03609-x). Simulation accuracy is worse outside the US and for some groups. **[POLICY]** (public opinion)
- [13] Boelaert, J., Coavoux, S., Ollion, É., Petev, I., Präg, P. (2025). "Machine Bias. How Do Generative Language Models Answer Opinion Polls?" *Sociological Methods & Research* 54, 1156–1196. — [doi:10.1177/00491241251330582](https://doi.org/10.1177/00491241251330582). LLM survey answers show a systematic "machine bias" (low variance, not tied to any demographic) rather than mirroring groups.
- [14] Broska, D., Howes, M., van Loon, A. (2025). "The Mixed Subjects Design: Treating Large Language Models as Potentially Informative Observations." *Sociological Methods & Research* 54, 1074–1109. — [doi:10.1177/00491241251326865](https://doi.org/10.1177/00491241251326865). A statistical framework (prediction-powered inference) for combining a few humans with many LLM "subjects" without bias. This is the principled way to use agents.

**A3. Concerns: caricature, stereotyping, flattening, illusions of understanding**
- [11] Wang, A., Morgenstern, J., Dickerson, J.P. Cited as a 2024 preprint, "LLMs cannot replace human participants because they cannot portray identity groups." **Now published** as "Large language models that replace human participants can harmfully misportray and flatten identity groups," *Nature Machine Intelligence* 7, 400–411 (2025). — [doi:10.1038/s42256-025-00986-z](https://doi.org/10.1038/s42256-025-00986-z). Identity-prompted LLMs portray groups as outsiders see them and erase within-group variety. This is the main motivation for grounding agents in individuals.
- [20] Cheng, M., Piccardi, T., Yang, D. (2023). "CoMPosT: Characterizing and Evaluating Caricature in LLM Simulations." *EMNLP 2023*, 10853–10875. — [doi:10.18653/v1/2023.emnlp-main.669](https://doi.org/10.18653/v1/2023.emnlp-main.669). Measures how simulations exaggerate stereotyped features ("caricature").
- [34] Messeri, L., Crockett, M.J. (2024). "Artificial intelligence and illusions of understanding in scientific research." *Nature* 627, 49–58. — [doi:10.1038/s41586-024-07146-0](https://doi.org/10.1038/s41586-024-07146-0). Warns that AI "surrogates" can create monocultures and false confidence in science.

**A4. Predicting human outcomes with ML (the "outcome-specific" approach the paper contrasts itself with)**
- [9] Salganik, M.J., Lundberg, I., Kindel, A.T., et al. (2020). "Measuring the predictability of life outcomes with a scientific mass collaboration." *PNAS* 117, 8398–8403. — [doi:10.1073/pnas.1915006117](https://doi.org/10.1073/pnas.1915006117). In the Fragile Families Challenge, 160 teams with rich data predicted life outcomes poorly. This sets the ceiling for structured-data ML.
- [15] Lundberg, I., Brown-Weinstock, R., Clampet-Lundquist, S., et al. (2024). "The origins of unpredictability in life outcome prediction tasks." *PNAS* 121, e2322973121. — [doi:10.1073/pnas.2322973121](https://doi.org/10.1073/pnas.2322973121). Uses interviews to explain why outcomes are unpredictable (unmeasurable events and the like).
- [4] Verhagen, M.D., Stroebl, B., Liu, T., Liu, L.T., Salganik, M.J. (2025). "The Book of Life approach: Enabling richness and scale for life course research." — [arXiv:2507.03027](https://arxiv.org/abs/2507.03027). Converts registry data into text "life books" for LLMs.
- [32] Ansolabehere, S., Rodden, J., Snyder, J.M. (2008). "The Strength of Issues: Using Multiple Measures to Gauge Preference Stability, Ideological Constraint, and Issue Voting." *APSR* 102, 215–232. — [doi:10.1017/S0003055408080210](https://doi.org/10.1017/S0003055408080210). Single survey items are noisy and averaging items stabilizes them. This is the rationale for normalizing by test-retest. **[POLICY]** (issue voting)

**A5. Measurement instruments**
- [19] NORC, "General Social Survey, 2023" — [gss.norc.org](https://gss.norc.org) (official site; not a paper). [59] Marsden, P.V., Smith, T.W., Hout, M. (2020). "Tracking US Social Change Over a Half-Century: The General Social Survey at Fifty." *Annual Review of Sociology* 46, 109–134. — [doi:10.1146/annurev-soc-121919-054838](https://doi.org/10.1146/annurev-soc-121919-054838). Background on the GSS.
- [18] Stanford Center on Poverty and Inequality, "American Voices Project" — [methodology page](https://inequality.stanford.edu/avp/methodology) (URL as given in the paper; not separately verified). This is the source of the interview protocol.
- [33] John, O.P., Srivastava, S. (1999). "The Big Five trait taxonomy: History, measurement, and theoretical perspectives." In *Handbook of Personality* (2nd ed.), Guilford, 102–138. A book chapter with no DOI; it is the source of the BFI-44.
- Economic games:
  - [21] Forsythe, R., Horowitz, J.L., Savin, N.E., Sefton, M. (1994). "Fairness in Simple Bargaining Experiments." *Games and Economic Behavior* 6, 347–369. — [doi:10.1006/game.1994.1021](https://doi.org/10.1006/game.1994.1021) (dictator game).
  - [22] Berg, J., Dickhaut, J., McCabe, K. (1995). "Trust, Reciprocity, and Social History." *GEB* 10, 122–142. — [doi:10.1006/game.1995.1027](https://doi.org/10.1006/game.1995.1027) (trust game).
  - [23] Ledyard (1995) on public goods, in the *Handbook of Experimental Economics*; [24] Rapoport & Chammah (1965), *Prisoner's Dilemma*; [63] Camerer (2003), *Behavioral Game Theory*. These three are books or chapters with no DOI checked.
- **[POLICY]** For readers simulating central bankers or legislators: none of these instruments measure elite or institutional decision-making. They measure the general public.

**A6. Experiments replicated (all PNAS, from the Mechanical Turk Replication Project [30], [mtrp.info](https://mtrp.info/index.html), URL not separately verified)**
- [25] Ames, D.L., Fiske, S.T. (2015). "Perceived intent motivates people to magnify observed harms." *PNAS* 112, 3599–3605. — [doi:10.1073/pnas.1501592112](https://doi.org/10.1073/pnas.1501592112)
- [26] Cooney, G., Gilbert, D.T., Wilson, T.D. (2016). "When fairness matters less than we expect." *PNAS* 113, 11168–11171. — [doi:10.1073/pnas.1606574113](https://doi.org/10.1073/pnas.1606574113)
- [27] Halevy, N., Halali, E. (2015). "Selfish third parties act as peacemakers by transforming conflicts and promoting cooperation." *PNAS* 112, 6937–6942. — [doi:10.1073/pnas.1505067112](https://doi.org/10.1073/pnas.1505067112)
- [28] Rai, T.S., Valdesolo, P., Graham, J. (2017). "Dehumanization increases instrumental violence, but not moral violence." *PNAS* 114, 8511–8516. — [doi:10.1073/pnas.1705238114](https://doi.org/10.1073/pnas.1705238114)
- [29] Schilke, O., Reimann, M., Cook, K.S. (2015). "Power decreases trust in social exchange." *PNAS* 112, 12950–12955. — [doi:10.1073/pnas.1517057112](https://doi.org/10.1073/pnas.1517057112)

**A7. Classic agent-based modeling (supplementary/background)**
- [40] Schelling, T.C. (1971). "Dynamic models of segregation." *J. Math. Sociology* 1, 143–186. — [doi:10.1080/0022250X.1971.9989794](https://doi.org/10.1080/0022250X.1971.9989794)
- [46] Bonabeau, E. (2002). "Agent-based modeling: Methods and techniques for simulating human systems." *PNAS* 99 (suppl. 3), 7280–7287. — [doi:10.1073/pnas.082080899](https://doi.org/10.1073/pnas.082080899)
- [47] Macy, M.W., Willer, R. (2002). "From Factors to Actors: Computational Sociology and Agent-Based Modeling." *Annual Review of Sociology* 28, 143–166. — [doi:10.1146/annurev.soc.28.110601.141117](https://doi.org/10.1146/annurev.soc.28.110601.141117)
- [39] Bruch, E., Atwell, J. (2015). "Agent-Based Models in Empirical Social Research." *Sociological Methods & Research* 44, 186–221. — [doi:10.1177/0049124113506405](https://doi.org/10.1177/0049124113506405)
- [43] Carley, K.M. (1992). "Organizational Learning and Personnel Turnover." *Organization Science* 3, 20–46. — [doi:10.1287/orsc.3.1.20](https://doi.org/10.1287/orsc.3.1.20)
- Also cited, as books or working papers with no DOI checked: Epstein & Axtell (1996) *Growing Artificial Societies* [41]; Axtell (2000) "Why agents?" [42]; Lustick (2002) PS-I, *JASSS* 5(3) [44]; Schelling (1978) *Micromotives and Macrobehavior* [45]; von Neumann & Morgenstern (1944) [48]; McFadden (1974) conditional logit [49].

**A8. Fairness metric, methods and LLM engineering**
- [36] Hardt, M., Price, E., Srebro, N. (2016). "Equality of Opportunity in Supervised Learning." *NeurIPS 29*. — [arXiv:1610.02413](https://arxiv.org/abs/1610.02413). Supports the group-disparity metric (DPD). Barocas, Hardt & Narayanan, *Fairness and Machine Learning* [37], is at [fairmlbook.org](https://fairmlbook.org).
- [54] Liu, N.F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., Liang, P. "Lost in the Middle: How Language Models Use Long Contexts." *TACL*. — [doi:10.1162/tacl_a_00638](https://doi.org/10.1162/tacl_a_00638). LLMs under-use information in the middle of long prompts, which matters when injecting a 6,500-word transcript. **Citation discrepancy:** the paper cites "TACL 11, 1312–1327 (2024)", while Crossref lists TACL vol. 12, pp. 157–173 (2024).
- [64] Nosek, B.A., et al. (2015). "Promoting an open research culture." *Science* 348, 1422–1425. — [doi:10.1126/science.aab2374](https://doi.org/10.1126/science.aab2374)
- [66] Silver, N.C., Dunlap, W.P. (1987). "Averaging correlation coefficients: Should Fisher's z transformation be used?" *J. Applied Psychology* 72, 146–148. — [doi:10.1037/0021-9010.72.1.146](https://doi.org/10.1037/0021-9010.72.1.146)
- [38] Stagnaro, M.N., Druckman, J., Berinsky, A.J., Arechar, A.A., Willer, R., Rand, D. (2024). "Representativeness versus Response Quality: Assessing Nine Opt-In Online Survey Samples." OSF preprint (URL as given in the paper; **not verified**). It supports the choice of sample vendor.
- Survey and interview method texts (books, no DOI): Groves et al. *Survey Methodology* [52]; Brinkmann & Kvale *InterViews* [53]; Lareau *Listening to People* [16]; Weiss *Learning From Strangers* [17]; Reeves & Nass *The Media Equation* [55].
- Not verified: Strus & Cieciuch (2019), *J. Research in Personality* 82, 103844 [62] (my DOI guess returned a 404 from Crossref); Schmitt et al. (2023) PsyArXiv "Big Five Across Time, Space, and Method" [61]. Also cited: OpenAI documentation pages for TTS, Whisper and GPT-4 [56–58] and the GSS codebooks [51, 60].

### Inferences
- The citation choices show what the paper positions itself against. On one side is demographic-prompted "silicon sampling" (Argyle; Santurkar; Wang et al.; Cheng et al.). On the other is outcome-specific ML (Salganik; Lundberg). It positions itself as the middle path: individual grounding plus general-purpose LLM inference.
- Two cited preprints have since been published in prominent venues: Ashokkumar/Hewitt in *Nature* 2026 and Wang et al. in *Nature Machine Intelligence* 2025. Cite the published versions.

### Gaps
- I did not resolve DOIs for the book chapters, the OSF/PsyArXiv preprints [38, 61], or [62].

---

## Q4. Related works and works that cite or build on it (2024–2026): annotated reading list B

### Takeaway
Follow-up work has split into four strands:
- **(a) Individual "digital twin" datasets and benchmarks.** Twin-2K-500; the "Funhouse Mirrors" mega-study, which found much weaker individual-level accuracy (average r = 0.20) on new outcomes; SOEP/LISS twins.
- **(b) Foundation models of human behavior.** Centaur in *Nature* 2025; Be.FM.
- **(c) Validation and critique.** Kozlowski & Evans; Gao et al. in PNAS; Wang et al. in NMI; "not yet reliable".
- **(d) Applied simulations of societies and policy.** AgentSociety, SocioVerse, EconAgent, LLM Economist, and a fast-growing set of FOMC, legislature, voter and stakeholder simulators.

### Cited Findings
**B1. Direct successors: individual-level simulation, datasets, benchmarks**
- Peng, T., Gui, G., Brucks, M., Merlau, D.J., Fan, G.J., Ben Sliman, M., et al. (2025). "Digital Twins as Funhouse Mirrors: Five Key Distortions." — [arXiv:2509.19088](https://arxiv.org/abs/2509.19088). The most important reality check. Across 19 preregistered studies and 164 outcomes, twins built from more than 500 answers per person (Twin-2K-500) were "only modestly more accurate than a homogeneous base LLM", with an average correlation with human responses of r = 0.20. It identifies five distortions: insufficient individuation, stereotyping, representation bias, ideological bias and hyper-rationality. **[POLICY]** (warns against deploying twins for policy research)
- Toubia et al. (2025) Twin-2K-500. See [3] in list A. — [doi:10.1287/mksc.2025.0262](https://doi.org/10.1287/mksc.2025.0262)
- Moon, S., Abdulhai, M., Kang, M., Suh, J., Soedarmadji, W., Kohen Behar, E., et al. (2024). "Virtual Personas for Language Models via an Anthology of Backstories." — [arXiv:2407.06576](https://arxiv.org/abs/2407.06576). Conditions LLMs on rich, naturalistic first-person backstories, matched to survey respondents, to better approximate Pew survey distributions. This is a cheaper analogue of interview grounding.
- Hu, T., Collier, N. (2024). "Quantifying the Persona Effect in LLM Simulations." — [arXiv:2402.10811](https://arxiv.org/abs/2402.10811). Persona variables explain only a small share of variance in annotation and opinion tasks.
- Suh, J., Jahanparast, E., Moon, S., Kang, M., Chang, S. (2025). "Language Model Fine-Tuning on Scaled Survey Data for Predicting Distributions of Public Opinions." — [arXiv:2502.16761](https://arxiv.org/abs/2502.16761). Fine-tuning on large survey corpora beats prompting for predicting subgroup opinion distributions. **[POLICY]**
- Suh, J., Moon, S., Chang, S. (2025). "Graph-Based Alternatives to LLMs for Human Simulation." — [arXiv:2511.02135](https://arxiv.org/abs/2511.02135). A graph neural network matches or beats LLM simulators on closed-ended survey-prediction tasks. Simpler baselines matter.
- Kinzinger, L., Hartmann, J. (2026). "Synthetic Personalities: How Well Can LLMs Mimic Individual Respondents Using Socio-Economic Microdata?" — [arXiv:2606.04592](https://arxiv.org/abs/2606.04592). Twins built from existing German SOEP panel data reach 78.8% held-out accuracy, with diminishing returns as more information is added.
- Jia, M., Chen, Y., Sharma, D., Diaz-Rodriguez, J. (2026). "When Can Digital Personas Reliably Approximate Human Survey Findings?" — [arXiv:2605.10659](https://arxiv.org/abs/2605.10659). Using the Dutch LISS panel with pre-cutoff histories and post-cutoff tests: personas help with response distributions but remain limited for individual prediction and for heterogeneous or rare responses.
- Wang, S., Hunt, K., Tang, S., Joseph, K. (2026). "When Can LLM Digital Twins Reduce Human Measurement? From Behavioral Fidelity to Statistical Substitutability." — [arXiv:2609.07987](https://arxiv.org/abs/2609.07987). Twins reproduce average effects but carry little information about which individuals deviate. Judge twins by whether they reduce uncertainty, not by how well they mimic.
- Li, Y., Venkit, P.N., Pruksachatkun, Y., Wu, C.-S. (2026). "InterviewSim: A Scalable Framework for Interview-Grounded Personality Simulation." — [arXiv:2602.20294](https://arxiv.org/abs/2602.20294). Extends interview grounding, evaluating against what people actually said.
- Moon, S., Kang, M., Suh, J., Safdari, M., Canny, J. (2026). "Identity, Cooperation and Framing Effects within Groups of Real and Simulated Humans." — [arXiv:2601.16355](https://arxiv.org/abs/2601.16355). Social-dilemma games with real and simulated humans.
- Cross, L., Haber, N., Yamins, D.L.K. (2025). "Validating Generative Agent-Based Models of Social Norm Enforcement: From Replication to Novel Predictions." — [arXiv:2507.22049](https://arxiv.org/abs/2507.22049). A two-stage validation protocol: replicate known results first, then make novel predictions.

**B2. Foundation models of human behavior and experiment prediction**
- Binz, M., Akata, E., Bethge, M., Brändle, F., Callaway, F., Coda-Forno, J., et al. (2025). "A foundation model to predict and capture human cognition" (Centaur). *Nature* 644, 1002–1009. — [doi:10.1038/s41586-025-09215-4](https://doi.org/10.1038/s41586-025-09215-4). An LLM fine-tuned on trial-by-trial data from 160 psychology experiments (the "Psych-101" dataset). It is the "train a behavior model" alternative to Park's "prompt with self-reports" approach.
- Xie, Y., Li, Z., Wang, X., Pan, Y., Liu, Q., Cui, X., et al. (2025). "Be.FM: Open Foundation Models for Human Behavior." — [arXiv:2505.23058](https://arxiv.org/abs/2505.23058). An open model fine-tuned on behavioral data.
- Ashokkumar, Hewitt, Ghezae, Willer (2026), *Nature*. See [1] above. — [doi:10.1038/s41586-026-10742-x](https://doi.org/10.1038/s41586-026-10742-x). **[POLICY]**
- Aher, G., Arriaga, R.I., Kalai, A.T. (2023). "Using Large Language Models to Simulate Multiple Humans and Replicate Human Subject Studies." *ICML 2023*. — [arXiv:2208.10264](https://arxiv.org/abs/2208.10264). Introduced "Turing Experiments" and found a "hyper-accuracy distortion" in larger models. Not cited by Park et al.

**B3. Position papers, validation frameworks and critiques**
- Kozlowski, A.C., Evans, J. (2025). "Simulating Subjects: The Promise and Peril of Artificial Intelligence Stand-Ins for Social Agents and Interactions." *Sociological Methods & Research* 54(3), 1017–1073. — [doi:10.1177/00491241251337316](https://doi.org/10.1177/00491241251337316). A comprehensive review of where LLM stand-ins fail: uniformity, bias, temporal and contextual limits.
- Gao, Y., Lee, D., Burtch, G., Fazelpour, S. (2025). "Take caution in using LLMs as human surrogates." *PNAS* 122. — [doi:10.1073/pnas.2501660122](https://doi.org/10.1073/pnas.2501660122); [arXiv:2410.19599](https://arxiv.org/abs/2410.19599). On the "11–20 money request game", LLMs fail to reproduce human reasoning depth distributions.
- Wang, Morgenstern, Dickerson (2025), *Nat. Mach. Intell.* See [11]. — [doi:10.1038/s42256-025-00986-z](https://doi.org/10.1038/s42256-025-00986-z)
- Bisbee, J., Clinton, J.D., Dorff, C., Kenkel, B., Larson, J.M. (2024). "Synthetic Replacements for Human Survey Data? The Perils of Large Language Models." *Political Analysis* 32, 401–416. — [doi:10.1017/pan.2024.5](https://doi.org/10.1017/pan.2024.5). ChatGPT "feeling thermometer" answers have too little variance, regressions on them are wrong, and results shift with prompt wording and over time. **[POLICY]** (the core political-science critique). Not cited by Park et al.
- Dillion, D., Tandon, N., Gu, Y., Gray, K. (2023). "Can AI language models replace human participants?" *Trends in Cognitive Sciences* 27, 597–600. — [doi:10.1016/j.tics.2023.04.008](https://doi.org/10.1016/j.tics.2023.04.008). An influential short piece that compared GPT-3.5's moral judgments with human judgments and discusses when replacing participants is appropriate. I did not re-check its exact correlation figure. Not cited by Park et al.
- Wang, Q., Wu, J., Jiang, Z., Tang, Z., Luo, B., Chen, N., et al. (2025). "LLM-based Human Simulations Have Not Yet Been Reliable." — [arXiv:2501.08579](https://arxiv.org/abs/2501.08579). A position paper that systematically reviews discrepancies between simulated and real human outcomes.
- Madden, E.R. (2025). "Evaluating the Use of Large Language Models as Synthetic Social Agents in Social Science Research." — [arXiv:2509.26080](https://arxiv.org/abs/2509.26080). Cautions on interpretation and a "pragmatic reframing."
- Jang, C., Min, J., Choi, J., Lee, D., Lee, H., Park, J., et al. (2026). "From Simulated Citizens to Simulated Deliberation: Challenges in Representation and Interaction." — [arXiv:2609.07573](https://arxiv.org/abs/2609.07573). Census-grounded Korean persona agents debating real policy questions do **not** reproduce national survey opinion patterns. Their responses are over-concentrated and sometimes reverse demographic differences. **[POLICY]**
- Grossmann, I., Feinberg, M., Parker, D.C., Christakis, N.A., Tetlock, P.E., Cunningham, W.A. (2023). "AI and the transformation of social science research." *Science* 380, 1108–1109. — [doi:10.1126/science.adi1778](https://doi.org/10.1126/science.adi1778). An early agenda piece.
- Bail, C.A. (2024). "Can Generative AI improve social science?" *PNAS* 121. — [doi:10.1073/pnas.2314021121](https://doi.org/10.1073/pnas.2314021121). Overview of opportunities and risks.

**B4. Large-scale societal simulation platforms**
- Piao, J., Yan, Y., Zhang, J., Li, N., Yan, J., Lan, X., et al. (2025). "AgentSociety: Large-Scale Simulation of LLM-Driven Generative Agents Advances Understanding of Human Behaviors and Society." — [arXiv:2502.08691](https://arxiv.org/abs/2502.08691). More than 10,000 agents, used to study polarization, inflammatory messages, universal basic income and hurricane responses. **[POLICY]** (policy what-ifs)
- Zhang, X., Lin, J., Mou, X., Yang, S., Liu, X., Sun, L., et al. (2025). "SocioVerse: A World Model for Social Simulation Powered by LLM Agents and A Pool of 10 Million Real-World Users." — [arXiv:2504.10157](https://arxiv.org/abs/2504.10157). Agent profiles are drawn from real social-media users, with election, news-feedback and economic-survey case studies. **[POLICY]**
- Vezhnevets, A.S., Agapiou, J.P., Aharon, A., Ziv, R., Matyas, J., Duéñez-Guzmán, E.A., et al. (2023). "Generative agent-based modeling with actions grounded in physical, social, or digital space using Concordia." — [arXiv:2312.03664](https://arxiv.org/abs/2312.03664). Google DeepMind's open generative agent-based modeling library.
- Li, N., Gao, C., Li, M., Li, Y., Liao, Q. (2023/2024). "EconAgent: Large Language Model-Empowered Agents for Simulating Macroeconomic Activities." — [arXiv:2310.10436](https://arxiv.org/abs/2310.10436) (reported as ACL 2024; venue not re-verified). LLM households respond to tax and interest-rate policy and reproduce macro regularities. **[POLICY]**
- Karten, S., Li, W., Ding, Z., Kleiner, S., Bai, Y., Jin, C. (2025). "LLM Economist: Large Population Models and Mechanism Design in Multi-Agent Generative Simulacra." — [arXiv:2507.15815](https://arxiv.org/abs/2507.15815). A planner agent designs tax schedules for census-calibrated worker agents. **[POLICY]**
- Hao, Y., Xie, D. (2025). "A Multi-LLM-Agent-Based Framework for Economic and Public Policy Analysis." — [arXiv:2502.16879](https://arxiv.org/abs/2502.16879). Uses different LLMs as heterogeneous agents and simulates interest-income tax effects. **[POLICY]**

**B5. Simulating policymakers: central banks, legislators, political actors** (all **[POLICY]**)
- Kazinnik, S., Sinclair, T.M. (2025; revised 16 Jul 2026). "FOMC In Silico: A Multi-Agent System for Monetary Policy Decision Modeling." GWU Center for Economic Research Working Paper 2025-005. — [EconPapers/RePEc](https://econpapers.repec.org/paper/gwcwpaper/2025-005.htm); [2026 version PDF (NBER conference)](https://conference.nber.org/conf_papers/f244384.pdf).
  - Each LLM agent represents one FOMC member and receives real-time macro and district data.
  - **The July 2026 version backtests 218 FOMC meetings (2000 to June 2026): MAE of 8.3 bp on the policy rate, within 25 bp in 94% of meetings, and 91% of hike/cut/hold decisions correctly classified.** Accuracy is "similar before and after the model's training cutoff."
  - Counterfactuals: committee composition matters far more than the chair, and deliberation builds consensus rather than improving forecasts.
  - The Oct 2025 draft instead replayed the July 2025 meeting (4.42% from the LLM track vs 4.38% from the Monte Carlo voting model) under political-pressure and jobs-revision scenarios ([ECB conference PDF](https://www.ecb.europa.eu/press/conferences/shared/pdf/20260323_forecasting/Kazinnik_paper.pdf)).
- Seok, S., Wen, S., Yang, Q., Feng, J., Yang, W. (2024). "MiniFed: Integrating LLM-based Agentic-Workflow for Simulating FOMC Meeting." — [arXiv:2410.18012](https://arxiv.org/abs/2410.18012). A five-stage FOMC meeting simulation for projecting the Fed funds rate.
- Hou, Y., Rao, T., Tan, J., Viton, A., Zhang, X., Ye, D., et al. (2025). "FedSight AI: Multi-Agent System Architecture for Federal Funds Target Rate Prediction." — [arXiv:2512.15728](https://arxiv.org/abs/2512.15728). Member agents read the Beige Book and indicators, debate and vote. It reports 93.75% accuracy on 2023–2024 meetings, a small test window.
- Takano, K., Hirano, M., Nakagawa, K. (2026). "Modeling Hawkish-Dovish Latent Beliefs in Multi-agent Debate-Based LLMs for Monetary Policy Decision Classification." *Lecture Notes in Computer Science*, 488–505. — [doi:10.1007/978-3-032-13562-9_38](https://doi.org/10.1007/978-3-032-13562-9_38); [arXiv:2511.02469](https://arxiv.org/abs/2511.02469). Agents carry a latent hawkish/dovish belief and debate their way to FOMC decision classifications.
- Collodel, U. (2025). "Interpreting the Interpreter: Can We Model post-ECB Conferences Volatility with LLM Agents?" — [arXiv:2508.13635](https://arxiv.org/abs/2508.13635). 30 simulated traders read ECB press conferences, and their disagreement correlates about 0.5 with realized OIS volatility (293 events, 1998–2026). This simulates **market reaction to policy communication**.
- Li, H., Gong, R., Jiang, H. (2024). "Political Actor Agent: Simulating Legislative System for Roll Call Votes Prediction with Large Language Models." — [arXiv:2412.07144](https://arxiv.org/abs/2412.07144). Role-playing legislator agents predict House roll-call votes (117th–118th Congress).
- Helm, H., Chen, T., McGuinness, H., Lee, P., Duderstadt, B., Priebe, C.E. (2025). "Toward a digital twin of U.S. Congress." — [arXiv:2505.00006](https://arxiv.org/abs/2505.00006). Language models conditioned on each member's tweets produce tweets that are hard to tell from the real ones. The generated tweets are then used to predict roll-call votes and party-line defections. **Cites Park et al.** (per the Firecrawl citers list).
- Kreutner, M., Lutz, M., Strohmaier, M. (2025). "Persona-driven Simulation of Voting Behavior in the European Parliament with Large Language Models." — [arXiv:2506.11798](https://arxiv.org/abs/2506.11798). Zero-shot MEP personas predict individual votes with a weighted F1 of about 0.79.
- Baker, Z.R., Azher, Z.L. (2024). "Simulating The U.S. Senate: An LLM-Driven Agent Approach to Modeling Legislative Behavior and Bipartisanship." — [arXiv:2406.18702](https://arxiv.org/abs/2406.18702). Qualitative simulation of Senate committee debate.
- Le, L., Bui, M., Nguyen, M.C., Schlosser, Z., Williams-King, D. (2026). "GPS-Bench: A Governance Policy Benchmark for Automating Policy Analysis." — [arXiv:2609.03553](https://arxiv.org/abs/2609.03553). An evidence-grounded benchmark that links policies to affected actors and their actions, built from legislative records, lobbying disclosures, regulatory documents and filings. Its finding: **fine-tuning on the grounded record beats multi-agent simulation** for predicting actor-level impact.
- Aoki, G., Ghaffarzadegan, N. (2026). "AI Agents as Policymakers in Simulated Epidemics." — [arXiv:2601.04245](https://arxiv.org/abs/2601.04245). An LLM "mayor" makes repeated policy decisions inside an epidemic (SEIR) model.

**B6. Simulating voters, the public and stakeholders' reactions to policy** (all **[POLICY]**)
- Yu, C., Ye, J., Li, Y., Li, Z., Ferrara, E., Hu, X., et al. (2024). "A Large-Scale Simulation on Large Language Models for Decision-Making in Political Science." — [arXiv:2412.15291](https://arxiv.org/abs/2412.15291). Multi-step reasoning voter personas calibrated to real voter data, used to simulate US presidential elections.
- Zhang, X., Lin, J., Sun, L., Qi, W., Yang, Y., Chen, Y., et al. (2024). "ElectionSim: Massive Population Election Simulation Powered by Large Language Model Driven Agents." — [arXiv:2410.20746](https://arxiv.org/abs/2410.20746)
- Parikh, R., Cen, S.H., Podimata, C. (2026). "Do LLMs Track Public Opinion? A Multi-Model Study of Favorability Predictions in the 2024 U.S. Presidential Election." — [arXiv:2602.06302](https://arxiv.org/abs/2602.06302). Cites Park et al.
- Gong, E., Sanders, N.E., Schneier, B. (2026). "Characterizing the ability of LLMs to recapitulate Americans' distributional responses to public opinion polling questions across political issues." — [arXiv:2603.20229](https://arxiv.org/abs/2603.20229). Cites Park et al.
- Kim, J., Lee, B. (2023). "AI-Augmented Surveys: Leveraging Large Language Models and Surveys for Opinion Prediction." — [arXiv:2305.09620](https://arxiv.org/abs/2305.09620). LLMs fine-tuned on GSS data impute missing opinion trends.
- Sun, S., Lee, E., Nan, D., Zhao, X., Lee, W., Jansen, B.J., et al. (2024). "Random Silicon Sampling: Simulating Human Sub-Population Opinion Using a Large Language Model Based on Group-Level Demographic Information." — [arXiv:2402.18144](https://arxiv.org/abs/2402.18144)
- Fulay, S., Dimitrakopoulou, D., Roy, D. (2025). "The Empty Chair: Using LLMs to Raise Missing Perspectives in Policy Deliberations." — [arXiv:2503.13812](https://arxiv.org/abs/2503.13812). LLM personas stand in for absent stakeholders in policy deliberation.
- Fulay, S., Zhu, J., Bakker, M. (2025). "From Delegates to Trustees: How Optimizing for Long-Term Interests Shapes Bias and Alignment in LLM." — [arXiv:2510.12689](https://arxiv.org/abs/2510.12689). Simulates votes on policy issues and contrasts "behavior-cloning" (delegate) with welfare-weighted (trustee) predictions.
- Tessler, M.H., Bakker, M.A., Jarrett, D., Sheahan, H., Chadwick, M.J., Koster, R., et al. (2024). "AI can help humans find common ground in democratic deliberation" (the "Habermas Machine"). *Science* 386. — [doi:10.1126/science.adq2852](https://doi.org/10.1126/science.adq2852). Not a simulation of people, but relevant to aggregating stakeholder views.
- Hou, A.B., Du, H., Wang, Y., Zhang, J., Wang, Z., Liang, P.P., et al. (2025). "Can A Society of Generative Agents Simulate Human Behavior and Inform Public Health Policy? A Case Study on Vaccine Hesitancy." — [arXiv:2503.09639](https://arxiv.org/abs/2503.09639). Cites Park et al.
- Koaik, F., Gupta, A., Sheikh, F.R. (2026). "LLM Powered Social Digital Twins: A Framework for Simulating Population Behavioral Response to Policy Interventions." — [arXiv:2601.06111](https://arxiv.org/abs/2601.06111). A calibration layer maps agent responses to observed metrics, with a COVID case study reporting a 20.7% error reduction versus gradient boosting.
- Yan, X., Dai, T., Nie, Y.M. (2025). "Addressing the alignment problem in transportation policy making: an LLM approach." — [arXiv:2510.13139](https://arxiv.org/abs/2510.13139). LLM resident agents vote in a transit-policy referendum (Chicago, Houston). Cites Park et al.
- Bachmann, F., van der Weijden, D., Heitz, L., Sarasua, C., Bernstein, A. (2025). "Adaptive political surveys and GPT-4: Tackling the cold start problem with simulated user interactions." *PLOS One* 20, e0322690. — [doi:10.1371/journal.pone.0322690](https://doi.org/10.1371/journal.pone.0322690). Cites Park et al.

### Inferences
- The strongest positive follow-up evidence concerns **aggregate or average** effects: Ashokkumar/Hewitt in *Nature* 2026, Cui et al. 2025, and Park's own experiment correlations. The strongest negative evidence concerns **individual-level prediction on new outcomes**: Funhouse Mirrors (r = 0.20), Jia et al. 2026, Wang et al. 2026. Park's high individual-level numbers come from canonical instruments (GSS, BFI) whose items are well represented in LLM training data. That may overstate accuracy for new or idiosyncratic questions.
- Policymaker simulators (FOMC, Congress, European Parliament) do not use Park's self-report method, because you cannot interview a Fed governor for two hours. They build personas from the **public record**: speeches, votes, tweets and biographies. This is conceptually the "grounding in individual-specific data" lesson from Park, applied with different data.

### Gaps
- The citer list came from one index (Firecrawl), which leans toward arXiv. Journal papers citing Park et al. may be under-represented, and I could not get Google Scholar or Semantic Scholar counts.
- I did not verify Centaur's critiques, or the follow-up debate on whether Centaur generalizes. These were not searched.
- I could not verify the venues for several arXiv-only items (for example EconAgent at ACL 2024, Political Actor Agent).

---

## Q5. Which related works matter most for using simulated agents to PREDICT POLICY DECISIONS or reactions to policy?

### Takeaway
For forecasting **decisions by policymakers** (central bankers, legislators, regulators), the most directly useful works are:
- Kazinnik & Sinclair's FOMC In Silico: the only one found with a long, out-of-sample-style backtest (218 meetings) and a training-cutoff check.
- The legislator vote simulators: Political Actor Agent, the Congress digital twin, the EP persona voting study.
- GPS-Bench, as a sobering evaluation template.

For forecasting **public or stakeholder reactions** to policy, the most useful are:
- Park et al. itself, for grounding individuals.
- Ashokkumar/Hewitt (Nature 2026), for predicting treatment effects of messages and framings, with an overestimation caveat.
- Argyle 2023 and Bisbee 2024, for the voter-simulation promise and its perils.
- Broska et al., for statistically valid human + AI designs.
- The Funhouse Mirrors and Jang et al. 2026 critiques.

### Cited Findings
- **Top policy-decision forecasting evidence**: FOMC In Silico's backtest of 218 FOMC meetings (2000 to June 2026): 8.3 bp MAE, 94% within 25 bp, 91% correct hike/cut/hold. It reports similar accuracy before and after the training cutoff, "suggesting the results are not driven by memorization." — [Kazinnik & Sinclair 2026 PDF](https://conference.nber.org/conf_papers/f244384.pdf)
- FedSight AI reports 93.75% on 2023–2024 meetings, outperforming MiniFed and a random-forest baseline. — [arXiv:2512.15728](https://arxiv.org/abs/2512.15728)
- Takano et al. find that debate-based multi-agent LLMs with latent hawkish/dovish beliefs outperform single-LLM baselines on FOMC decision classification. — [arXiv:2511.02469](https://arxiv.org/abs/2511.02469)
- Collodel finds that disagreement among simulated traders correlates about 0.5 with realized OIS volatility after ECB press conferences, robust out of sample from Jan 2025. — [arXiv:2508.13635](https://arxiv.org/abs/2508.13635)
- Legislators:
  - Political Actor Agent: role-playing legislator agents improve roll-call prediction on the 117th–118th House — [arXiv:2412.07144](https://arxiv.org/abs/2412.07144).
  - Congress digital twin: tweet-conditioned models used to predict roll-call votes and party-line crossing — [arXiv:2505.00006](https://arxiv.org/abs/2505.00006).
  - European Parliament personas: weighted F1 of about 0.79 — [arXiv:2506.11798](https://arxiv.org/abs/2506.11798).
- Policy-impact benchmark: in GPS-Bench, fine-tuning on the grounded record gave the strongest actor-level impact prediction, and multi-agent decomposition "does not beat it". What decomposition adds is mechanism. — [arXiv:2609.03553](https://arxiv.org/abs/2609.03553)
- Public reaction:
  - LLM predictions of survey-experiment treatment effects correlate strongly with the real effects but overestimate their size — [Nature 2026](https://doi.org/10.1038/s41586-026-10742-x); [GSB summary](https://www.gsb.stanford.edu/faculty-research/publications/large-language-models-can-predict-results-social-science-experiments).
  - Park's agents likewise inflated effect sizes (for example d = 2.97 vs 0.36 for humans) — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf).
- Caution on persona-based public simulation:
  - Census-grounded persona agents debating real policy questions over-concentrate opinions and sometimes reverse demographic gaps — [arXiv:2609.07573](https://arxiv.org/abs/2609.07573).
  - Digital twins correlate only r = 0.20 with individuals on new outcomes — [arXiv:2509.19088](https://arxiv.org/abs/2509.19088).
  - ChatGPT-generated survey data have too little variance and are sensitive to prompt and timing — [Bisbee et al. 2024](https://doi.org/10.1017/pan.2024.5).
- Grounding helps fairness. Demographic-only agents had a 13.75% GSS accuracy gap across political ideology groups, versus 8.60% for interview agents. This matters if a simulation must represent all sides of the political spectrum equally well. — [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)

### Inferences
- **Transferable lessons from Park et al. for policy prediction:**
  1. Ground each simulated actor in that specific actor's own record. For officials this means speeches, votes, testimony and dissents, which play the role of the interview transcript. Do not ground them in a demographic or party label.
  2. Benchmark against a noise ceiling. For a committee, an analogue of test-retest might be how predictable members are from their own past behavior, or the accuracy of market-implied probabilities.
  3. Hold out and de-duplicate. Make sure the "answer" (for example, post-meeting statements) is not in the agent's context, and test both before and after the model's training cutoff.
  4. Expect effect sizes to be exaggerated and calibrate them against real outcomes.
- **A key difference:** Park simulates ordinary individuals answering standardized questions, with a clean ground truth. Policy decisions are rare, high-stakes and strategic, and the actors' public positions are already priced in by markets. A large share of apparent "accuracy" may come from information the LLM has memorized, or from base rates (most FOMC meetings are "hold"). The 91% classification figure for FOMC In Silico should therefore be compared with a naive "predict hold / predict market-implied path" baseline. The abstract does not report that comparison.
- The literature suggests a hybrid design is most defensible: LLM agents generate scenarios and mechanisms, with statistical calibration on observed outcomes (Broska et al.'s mixed-subjects logic; GPS-Bench's finding that fine-tuning beats pure simulation).

### Gaps
- I found no peer-reviewed, journal-published study (as of Oct 2026) that validates LLM agents of **named regulators or central bankers** against out-of-sample decisions. The FOMC work is a working paper, and the others are arXiv preprints.
- I did not verify whether FOMC In Silico compares against market-implied (fed funds futures) baselines. That needs the full text.
- I did not search for simulations of non-US central banks (ECB Governing Council, BoE MPC votes) beyond Collodel's market-reaction paper, or for simulations of regulatory agencies (SEC, FCC) using notice-and-comment records.
