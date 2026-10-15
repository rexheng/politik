# Investors predict routine policy well and surprises poorly

Professional investors predict policy by blending three ingredients: market prices that already contain everyone's bets, models of how specific decision-makers behave, and people who know those decision-makers well. For scheduled central bank meetings the blend works remarkably well. One day before Federal Reserve meetings, the prediction market Kalshi had a **perfect record** in a 2026 Fed study, and futures markets missed essentially only the September 2024 half-point cut. Accuracy collapses further out: the Fed's own median projection matched the actual year-end rate only **about 36% of the time**. It also collapses at regime breaks such as the 2015 Swiss franc shock. For laws, regulators, courts and elections, forecasters start from historical base rates (only **about 4–6% of US bills become law**) and adjust for the people involved. Simple statistical models beat legal experts on Supreme Court cases (**75% vs 59%**), yet one-off shocks like Brexit fooled polls, models and betting markets together. The Park et al. paper adds a new kind of tool: AI agents built from a person's own two-hour interview or survey answers predicted that person's survey answers **83–86% as well as people matched their own answers two weeks later**, against 74% for agents given only demographics. Follow-up studies show such agents get averages and directions right but individuals and effect sizes wrong. The most advanced attempt to simulate policymakers, "FOMC In Silico", reports **about 91% correct hike/hold/cut calls over 218 Fed meetings**, but it is an unreviewed backtest that was never compared with market prices. For Politik, the evidence points to three rules: ground every simulated actor in their own public record, always show the market or crowd number beside the model, and prove accuracy with a live, dated track record.

## How this report is organised

The report has two parts. **Part 1** (sections 1–2) answers how hedge funds and other professionals predict policy: first central banks, then politics, legislation, regulation and geopolitics. **Part 2** (sections 3–6) covers the Park et al. paper, the work it cites, the work that followed it, and studies that use AI agents to predict policy decisions. Section 7 is a short "start here" reading path. Section 8 covers what this means for building Politik. Section 9 lists claims to treat with care.

Each section opens with its main point. Technical terms are defined once, in the glossary below. "Peer-reviewed" means independent experts checked the paper before a journal or conference published it. "Preprint" or "working paper" means the paper is public but has not been through that check. All facts are as of 15 October 2026.

## Key terms, defined once

| Term | Plain meaning |
|---|---|
| Basis point (bp) | One-hundredth of a percentage point. 25 bp = 0.25%. |
| Central bank, FOMC | A central bank sets a country's main interest rate. The FOMC (Federal Open Market Committee) is the 12-vote US Federal Reserve committee that does this. ECB, BoE and BoJ are the euro-area, UK and Japanese central banks. |
| Fed funds rate | The overnight interest rate the US Federal Reserve targets. |
| Futures contract | A contract that fixes a price today for something settled later. Its price shows what traders expect. |
| OIS (overnight indexed swap) | A contract that swaps a fixed rate for the average overnight rate. It is the cleanest market gauge of expected central bank rates. |
| Option | A contract giving the right, but not the duty, to buy or sell at a set price. Option prices reveal the whole range of outcomes traders expect, not just the average. |
| Implied probability | The probability a price implies. A contract paying $1 if an event happens, trading at $0.70, implies about 70%. |
| Prediction market | An exchange where people trade contracts that pay out if an event happens. Kalshi and Polymarket are the main US venues. |
| Risk premium | Extra return investors demand for carrying risk. It means market prices are not pure forecasts. |
| Reaction function | How a central bank tends to respond to inflation, jobs and financial markets. |
| Taylor rule | A simple formula that suggests an interest rate from inflation and the gap between actual and potential output. |
| Dot plot, SEP | The Fed's quarterly chart in which each official places a dot showing where they expect rates to go. It is part of the Summary of Economic Projections (SEP). |
| Forward guidance | A central bank's public hints about its future decisions. |
| Nowcast | A model's estimate of this quarter's data before the official figure is published. |
| Hawk, dove, swinger | A hawk favours higher rates to fight inflation. A dove favours lower rates to support jobs. A swinger moves between the two. |
| Blackout period | The days before a Fed meeting when officials stop speaking publicly about policy. |
| MNPI | Material non-public information. Trading on it in breach of a duty is insider trading. |
| Political intelligence (PI) | Information gathered from contact with officials and sold to investors. The term comes from the 2012 STOCK Act. |
| STOCK Act | A 2012 US law confirming that insider-trading rules apply to members of Congress and officials. |
| Base rate | How often something happened before, among similar cases. |
| Ideal point | A legislator's or judge's estimated position on a left–right scale, worked out from their past votes. |
| Merger-arbitrage spread | The gap between a takeover target's share price and the agreed deal price. A wider gap means the market sees more risk that regulators block the deal. |
| Brier score | A score for probability forecasts: the squared gap between the forecast and what happened (0 or 1). Lower is better; 0 is perfect. |
| Calibration | Whether events you call "70% likely" really happen about 70% of the time. |
| Superforecaster | A top performer in forecasting tournaments, such as the Good Judgment Project. |
| LLM | Large language model, such as GPT-4o. |
| Agent, generative agent | An LLM set up to act as a specific person or role, often with memory and instructions. |
| Persona | A written description of who the agent should be. |
| Silicon sample | A set of LLM "respondents" used in place of a human survey sample. |
| Digital twin | An agent built to mimic one specific real person. |
| Grounding | Giving an agent real data about the person it represents: an interview, survey answers, speeches or votes. |
| Backtest | Testing a model on past events. |
| Training cutoff, memorization, look-ahead bias | An LLM learns from text up to a date (its cutoff). It may "remember" what happened before then, which makes backtests look better than real forecasting. |
| Out-of-sample | Tested on data the model was not built on. |
| Normalized accuracy | Park et al.'s main score: the agent's accuracy divided by how consistently the person repeated their own answers two weeks later. |
| Effect size (Cohen's d) | How big a difference an experiment produces, in standard units. |
| MAE | Mean absolute error: the average size of a miss. |

# Part 1. How professionals predict policy decisions

## 1. Central banks: market prices call the next meeting almost perfectly

**Every professional forecast of a central bank decision starts from what markets already price.** Funds then try to beat that price with better models of the central bank, faster data, sharper reading of officials' words, and access to former officials. The market is very hard to beat on the next meeting. The openings lie further out, in the size of a move, and in moments when the central bank changes how it behaves.

### Futures and swaps turn prices into probabilities

The basic tool is arithmetic on futures prices. A 30-day fed funds futures contract settles on the average overnight Fed rate during its month. Its price equals 100 minus that rate, so **a price of 95.67 implies an average rate of 4.33%** ([CME Group](https://www.cmegroup.com/articles/2023/understanding-the-cme-group-fedwatch-tool-methodology.html)).

CME's FedWatch tool splits the meeting month into the days before and after the decision. It solves for the implied post-meeting rate, then divides the implied change by the usual 0.25-point step to get a "probability" of a move. CME's page returned an error during research, so these mechanics come from independent replications ([centralbank.watch](https://centralbank.watch/general-models/expanding-tree-method/); [pyfedwatch](https://pypi.org/project/pyfedwatch)). The same arithmetic works for other central banks using OIS contracts on their overnight rates (€STR, SONIA, TONA). The notes flag that last point as industry knowledge not confirmed in a source.

The method has a blind spot. A futures price is an average, so FedWatch only allows two neighbouring outcomes. A "60% chance of a quarter-point cut" can hide a real chance of a half-point cut. Professionals therefore also read options, which price the whole range. The **Atlanta Fed Market Probability Tracker** turns options on three-month SOFR futures into a full probability distribution, updated daily ([Atlanta Fed](https://www.atlantafed.org/cenfis/market-probability-tracker)).

Prediction markets are now a serious benchmark. A Federal Reserve working paper by Diercks, Katz and Wright found that Kalshi's median and most-likely forecast had **"a perfect forecast record on the day before the FOMC meeting"**. That was a statistically significant improvement over fed funds futures. Kalshi's inflation and unemployment forecasts were "on par" with Wall Street ([FEDS 2026-010](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm)). Much of its edge came from **September 2024**, when Kalshi priced the half-point cut while other forecasters were split ([Fortune](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/)). Two caveats apply: the paper is not peer-reviewed, and sources disagree on whether its sample ends in June 2024 or June 2025.

Market prices are not pure forecasts. Piazzesi and Swanson showed that fed funds futures earn extra returns that are **larger in bad economic times**, and that "simply ignoring these risk premia significantly biases forecasts" ([NBER w10547](https://www.nber.org/papers/w10547.pdf)). Schmeling, Schrimpf and Steffensen read the same returns differently. They argue the returns come mostly from investors' mistakes: markets **underestimate how far the Fed will cut** after rare, large shocks ([BIS WP 996](https://www.bis.org/publ/work996.pdf)).

The difference matters for strategy. If risk premia dominate, a fund can adjust prices mechanically. If mistakes dominate, the edge comes from understanding the Fed better than the market does. That second edge is what discretionary macro funds claim to have.

Funds also compare their views with surveys. Since January 2025 the New York Fed has run a single **Survey of Market Expectations** before each meeting and published the data ([NY Fed](https://www.newyorkfed.org/markets/primarydealer_survey_questions)).

### Funds model how the central bank reacts to data

**Behind every view on the market price sits a model of the central bank's reaction function.** The starting point is a simple rule such as the Taylor rule, which the Fed itself publishes alongside variants ([Federal Reserve](https://www.federalreserve.gov/monetarypolicy/policy-rules-and-how-policymakers-use-them.htm); not re-checked in this research).

The Fed's own projections are a strong anchor. A 2026 Fed paper by Engstrom finds the dot plot forecasts rates **better than consensus surveys, statistical models and several market measures at many horizons**. But it is only updated quarterly, so it goes stale, and forecasters anchored to old dots update too slowly ([FEDS 2026-026](https://www.federalreserve.gov/econres/feds/anchored-to-the-dot-plot-central-bank-projections-and-interest-rate-expectations.htm)). A practitioner count is harsher. Over ten years of June projections, the median dot matched the actual year-end rate **36% of the time for the current year and about 10% for the next year** ([CIBC](https://woodgundyadvisors.cibc.com/documents/506868/506932/Ditch+the+dots.pdf/21ec8ab0-97a0-4d15-928b-a0c868f9a630)).

Nowcasts feed the model with tomorrow's data today. The Atlanta Fed's GDPNow missed initial GDP estimates by **0.77 percentage points on average** from 2011 to 2025 ([Atlanta Fed](https://www.atlantafed.org/cqer/research/gdpnow)). The Cleveland Fed's inflation nowcast beat professional surveys on headline inflation ([Cleveland Fed WP 24-06](https://www.clevelandfed.org/publications/working-paper/2024/wp-2406-nowcasting-inflation)). When the October 2025 government shutdown halted official jobs data, markets fell back on private payroll data from ADP (−32,000 jobs for September) and a new Chicago Fed real-time unemployment estimate of about 4.3% ([Benzinga](https://www.benzinga.com/markets/economic-data/25/10/48011288/bls-data-halts-but-chicago-fed-sees-steady-4-34-unemployment-private-sources-flag-low-fire-low-hire-holiday-risk)).

The effort pays because Fed "surprises" are partly predictable. Bauer and Swanson show that many apparent surprises were linked to public data released before the meeting. Markets systematically **under-predict how strongly the Fed responds to economic news** ([NBER w29939](https://www.nber.org/papers/w29939)). Read together with Engstrom, this points to two repeatable weaknesses in market pricing: under-reaction to news, and over-anchoring on stale dots.

### Machines now read central bank language at scale

**Reading central bankers' words, often called "Fedspeak", has moved from human experts to computers, and since 2023 to LLMs.** LLMs classify hawkish and dovish language better than older methods, and banks now sell such scores to funds.

Early text-as-data work made language measurable. Hansen, McMahon and Prat used topic models on FOMC transcripts. They found that publishing transcripts after 1993 made members prepare more but made newcomers conform more ([LSE Research Online](https://researchonline.lse.ac.uk/id/eprint/58072)). Aruoba and Drechsel analysed the documents Fed staff write before meetings. The text held information "not captured by numerical forecasts" ([NBER w32417](https://www.nber.org/papers/w32417)).

LLMs raised the bar. The "Trillion Dollar Words" project created the standard labelled dataset of hawkish and dovish FOMC sentences ([ACL 2023](https://doi.org/10.18653/v1/2023.acl-long.368)). Hansen and Kazinnik found GPT models classify Fed statements better than older methods, but recommend them as an analyst aid, not a replacement ([FRBSF/Richmond Fed](https://www.frbsf.org/research-and-insights/publications/system-research-richmond-fed/2024/03/can-chatgpt-decipher-fedspeak/)). The Bank for International Settlements built central-bank-specific models that sometimes beat general LLMs ([BIS WP 1215](https://www.bis.org/publ/work1215.htm)). Peskoff and colleagues, including former Fed Vice Chair Alan Blinder, used GPT to measure disagreement between individual hawks and doves ([EMNLP Findings 2023](https://doi.org/10.18653/v1/2023.findings-emnlp.434)).

Banks sell these tools to funds. JPMorgan's 2023 ChatGPT-based **Hawk-Dove Score**, trained on 25 years of Fed text, found that **a 10-point rise in the score went with roughly a 10-percentage-point higher chance of a quarter-point hike** at the next meeting ([BNN Bloomberg](https://www.bnnbloomberg.ca/jpmorgan-s-ai-puts-25-years-of-fed-speeches-into-a-hawk-dove-score-1.1912721)). At the hedge fund Balyasny, chatbots cut central bank meeting previews from **about two days to about 30 minutes** ([Bloomberg](https://www.bloomberg.com/news/articles/2024-08-14/hedge-funds-battle-to-turn-chatgpt-from-intern-to-analyst)).

Words are not the only signal. Machine analysis of Fed Chairs' vocal tone shows that tone moves asset prices beyond the words spoken ([Gorodnichenko, Pham & Talavera](https://doi.org/10.1257/aer.20220129)). Negative facial expressions at press conferences lower stock prices and raise volatility ([Curti & Kazinnik](https://ideas.repec.org/a/eee/moneco/v139y2023icp110-126.html)).

Funds also map individual members. Bordo and Istrefi classify FOMC members since the 1960s as about **39% hawks, 30% doves and 24% swingers**. Where members studied and economic conditions when they were born help predict the label ([NBER w24650](https://www.nber.org/papers/w24650)). Malmendier, Nagel and Yan find that members' lifetime experience of inflation predicts their votes and dissents ([NBER w23228](https://www.nber.org/papers/w23228); not re-checked in this research).

### Part of the historical edge came from being close to information

**Central bank news has not always arrived at the scheduled announcement, and some investors profited from that.**

Lucca and Moench found that US stocks rose an average **49 basis points in the 24 hours before** scheduled FOMC announcements ([NY Fed SR512](https://www.newyorkfed.org/research/staff_reports/sr512.html)). The pattern **stopped appearing reliably after 2015** ([Kurov, Wolfe & Gilbert](https://ideas.repec.org/a/eee/finlet/v40y2021ics1544612320315956.html)), a textbook case of an anomaly fading after publication. Cieslak, Morse and Vissing-Jorgensen found the entire US equity premium since 1994 was earned in "even weeks" of the Fed's meeting cycle. They linked it to informal contact between officials, the media and the financial sector ([NYU Stern PDF](https://stern.nyu.edu/sites/default/files/assets/documents/cycle_paper_cieslak_morse_vissingjorgensen.pdf)).

Leaks and journalists matter. Bernile, Hu and Tang found that trading during FOMC media lock-ups pointed in the direction of the coming surprise; the Fed then tightened lock-up rules ([SMU repository](https://ink.library.smu.edu.sg/lkcsb_research/4229)). On 13 June 2022, during the Fed's blackout, a Wall Street Journal report said officials would consider a 0.75-point hike. Futures-implied odds of that hike moved from **about 25% to about 57%** that day ([investingLive](https://investinglive.com/centralbank/wsj-fedwatcher-speculates-about-a-75-basis-point-hike-20220613/)).

At the ECB, Ehrmann, Gnan and Rieder found **368 anonymous leaks** from 2002 to 2021. Leaks moved swap rates 60–95% more than normal, and more than on-the-record statements. Yet leaks often reflected **minority views** and usually did not point to the eventual decision ([ECB Blog](https://www.ecb.europa.eu/press/blog/date/2023/html/ecb.blog.230519~795de9b929.en.html)).

### Former officials sell judgment, and the line has sometimes blurred

**Funds hire former central bankers to understand how committees think.**

| Former official | Fund | Role | Source |
|---|---|---|---|
| Ben Bernanke (Fed Chair) | Citadel | Senior adviser from April 2015 | [CS Monitor](https://csmonitor.com/Business/2015/0416/Ben-Bernanke-gets-a-new-gig) |
| Jeremy Stein (Fed governor) | BlueMountain Capital | Adviser | [CS Monitor](https://csmonitor.com/Business/2015/0416/Ben-Bernanke-gets-a-new-gig) |
| Alan Greenspan (Fed Chair) | Paulson & Co. | Adviser from 2008 | [CS Monitor](https://csmonitor.com/Business/2015/0416/Ben-Bernanke-gets-a-new-gig) |
| Brian Sack (NY Fed markets head) | D.E. Shaw, then Balyasny | Global economics director 2013–2023, then portfolio manager and head of macro strategy (start date not confirmed) | [Yale bio](https://som.yale.edu/sites/default/files/2022-09/Brian%20Sack.pdf); [Hedgeweek](https://www.hedgeweek.com/de-shaw-md-joins-balyasny-as-pm-and-head-of-macro-strategy/) |
| Simon Potter (NY Fed markets head) | Millennium | Vice chairman, fixed income, from 2020 | [Bloomberg](https://www.bloomberg.com/news/articles/2020-08-06/millennium-said-to-hire-ex-new-york-fed-official-simon-potter) |
| Kevin Warsh (Fed governor) | Duquesne Family Office | Partner from about 2011; sworn in as Fed Chair on 22 May 2026 after a 54–45 Senate vote | [Georgetown](https://msb.georgetown.edu/profiles/kevin-warsh/); [ABA Banking Journal](https://bankingjournal.aba.com/2026/05/warsh-sworn-in-as-federal-reserve-chair/) |

These hires should supply a model of how the committee thinks, not inside information, because confidentiality and blackout rules apply. But the line has blurred more than once. A newsletter from Medley Global Advisors, a firm serving hedge funds, revealed details of the September 2012 FOMC debate a day before the official minutes. Richmond Fed President Jeffrey Lacker resigned in April 2017 after admitting he had spoken to the analyst ([HousingWire](https://www.housingwire.com/articles/39766-richmond-fed-president-jeffrey-lacker-resigns-admits-to-leaking-confidential-information/)). In 2021, two regional Fed presidents resigned over their personal trading, and the Fed tightened its ethics rules in February 2022 ([CNBC](https://www.cnbc.com/2024/01/22/watchdog-report-is-critical-of-former-fed-officials-in-stock-trading-controversy.html)). Claims about ex-official hires at Brevan Howard, Bridgewater or Rokos could not be verified.

### Accuracy is near perfect one day out and weak a year out

**How well these methods work depends mostly on the time horizon and on whether the central bank is signalling.**

| Method | Horizon | How accurate | Source |
|---|---|---|---|
| Kalshi prediction market | Day before a Fed meeting | Perfect record over the study period (end date disputed) | [FEDS 2026-010](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm) |
| Fed funds futures | Day before a Fed meeting | Very high; the main miss was the September 2024 half-point cut | [Fortune](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/) |
| Fed dot plot (median) | End of current year | Matched about 36% of the time | [CIBC](https://woodgundyadvisors.cibc.com/documents/506868/506932/Ditch+the+dots.pdf/21ec8ab0-97a0-4d15-928b-a0c868f9a630) |
| Fed dot plot (median) | End of next year | Matched about 10% of the time | [CIBC](https://woodgundyadvisors.cibc.com/documents/506868/506932/Ditch+the+dots.pdf/21ec8ab0-97a0-4d15-928b-a0c868f9a630) |
| Market pricing in downturns | Months ahead | Systematically underestimates how far the Fed cuts | [Schmeling et al.](https://www.bis.org/publ/work996.pdf) |
| GDPNow | Current quarter's GDP | Average miss 0.77 percentage points | [Atlanta Fed](https://www.atlantafed.org/cqer/research/gdpnow) |
| LLM committee simulation (FOMC In Silico) | Backtest, 218 meetings | About 91% right on hike/hold/cut; 8.3 bp average miss; not compared with markets | [NBER conference paper](https://conference.nber.org/conf_papers/f244384.pdf) |

The big failures cluster in predictable places. On 15 January 2015, days after calling its currency floor the "cornerstone" of policy, the Swiss National Bank scrapped it, and the franc jumped nearly 30% ([City A.M.](https://www.cityam.com/swiss-national-bank-shock-what-does-it-all-mean/)). On 20 December 2022, the Bank of Japan widened its bond-yield band while most analysts expected no change; the yen rose nearly 4% ([ING Think](https://think.ing.com/downloads/pdf/snap/bank-of-japan-surprise-surprise-surprise)). Step size is the other weak point: 0.75 vs 0.5 points in June 2022, and 0.5 vs 0.25 points in September 2024. Direction is usually priced right.

The Warsh Fed is a live test of these methods. At his first meeting, in June 2026, the FOMC **removed all forward guidance** from its statement. Warsh did not submit a dot, and five task forces began reviewing Fed communications, including the dot plot ([J.P. Morgan](https://www.jpmorgan.com/insights/markets-and-economy/economy/kevin-warsh-june-2026-federal-reserve-meeting-key-takeaways)). On 16 September 2026 the Fed **raised rates by 0.25 points to 3¾–4%, by 12 votes to 0** ([Federal Reserve](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm)). Secondary sources say markets expected the hike. One meeting cannot show whether accuracy has fallen. Still, less guidance from the Fed means less anchoring for markets, and more value in independent modelling of data and of individual members.

## 2. Politics, law and regulation: base rates, people and shared blind spots

**Outside central banks, decisions are less regular and markets are thinner, so funds rely more on people and structured reasoning.** The most reliable method starts from a base rate, adjusts for the positions of the people involved, and compares the result with a market price. The best evidence for an edge comes from regulatory information that flows through connected people. That channel is now legally riskier, and part of it has moved onto prediction markets.

### A "political intelligence" industry sells Washington insight

Funds buy analysis of Washington from three kinds of sources: independent policy research firms, policy teams at banks and brokers, and political-risk consultancies. Lobbyists, former officials and expert networks add more.

| Firm | What it does | Source |
|---|---|---|
| Capital Alpha Partners | Independent US policy research and forecasting: healthcare, energy, financials, defense | [Capital Alpha](https://www.capalphadc.com/) |
| Signum Global Advisors | Policy and markets advisory; offices in Washington, New York, London, Boston, Dubai | [Signum](https://signumglobal.com/) |
| Height Capital Markets | Combines policy research with fundamental analysis of regulated sectors | [FinNotes](https://finnotes.org/people/john-akridge) |
| Beacon Policy Advisors | Independent policy research (not the same firm as Beacon Global Strategies) | [CNBC](https://www.cnbc.com/stephen-myrow/) |
| Baird Strategas | Policy research led by Dan Clifton on trade, tax, healthcare and energy | [Baird](https://www.bairdwealth.com/insights/market-insights/strategas-analyst-biographies/daniel-clifton/) |
| Piper Sandler | US policy research led by Andy Laperriere | [Piper Sandler](https://pipersandler.com/about/people/andy-laperriere) |
| Eurasia Group | Global political risk; publishes an annual "Top Risks" list | [GZERO](https://gzeromedia.com/tag/eurasia-group-top-risks) |

The rankings these firms quote are self-reported. No independent, audited track record was found for any of them.

The law barely touches this industry directly. A 2013 report from the Government Accountability Office (GAO) found that **no law or ethics rule specifically governs political intelligence** beyond its definition in the STOCK Act. General insider-trading law still applies ([GAO-13-389](https://www.gao.gov/products/gao-13-389)). The market's size is unknown; one estimate put it at **$402 million in 2009** ([Mother Jones](https://www.motherjones.com/politics/2013/11/political-intelligence-industry-jellyfish/)). Expert networks such as Guidepoint bar current officials from discussing matters their agency regulates ([Guidepoint terms](https://www.guidepoint.com/wp-content/uploads/2025/07/Guidepoint-Terms-and-Conditions-June-2025.pdf)).

Two cases show where the legal line sits. In April 2013, Height Securities told clients that final Medicare Advantage rates would be far better than proposed, before the government announced them. The SEC traced the tip to a lobbyist's email about a deal in Congress. In 2015 a federal judge ruled that congressional staff are **not exempt from insider-trading law** ([Business Insurance](https://www.businessinsurance.com/judge-rules-for-sec-in-fight-with-house-panel-over-insider-trading-probe-paul-g/)). In the *Blaszczak* case, a former Medicare agency employee turned consultant passed confidential rate decisions to hedge fund clients. A jury convicted four people in 2018. But in December 2022 an appeals court held that an agency's confidential pre-decision information is not "property" under the federal fraud laws used, and vacated those convictions ([CRS](https://www.everycrsreport.com/reports/LSB10955.html)).

The policy fight has moved on. In July 2026 the House passed a ban on members buying new individual stocks, **232–198**; in late September the Senate vote failed, 53–47, short of the 60 needed ([Roll Call](https://rollcall.com/2026/07/22/congressional-stock-trading-bill-passes-the-house/); [Forbes](https://www.forbes.com/sites/saradorn/2026/09/30/lawmaker-stock-trading-ban-fails-senate/)). On 9 April 2025, President Trump posted "THIS IS A GREAT TIME TO BUY!!!" less than four hours before announcing a tariff pause that lifted stocks about 9.5%. Six senators asked the SEC to investigate ([Sen. Schiff](https://www.schiff.senate.gov/news/press-releases/news-sen-schiff-joins-sens-warren-schumer-to-call-on-sec-to-launch-investigation-into-possible-trump-tariff-market-manipulation-insider-trading/)).

### Connected funds earned extra returns until the STOCK Act

**Academic evidence shows that policy information is valuable, and that the edge goes to connected professionals rather than to politicians.**

Gao and Huang found that hedge funds linked to lobbyists beat benchmarks by **56–93 basis points per month** on politically sensitive stocks from 1999 to 2012. That edge **fell significantly after the STOCK Act** took effect ([Harvard Law School Forum](https://corpgov.law.harvard.edu/2016/08/26/capitalizing-on-capitol-hill-informed-trading-by-hedge-fund-managers/)). Firms' political contributions also predict their future stock returns ([Cooper, Gulen & Ovtchinnikov](https://ideas.repec.org/a/bla/jfinan/v65y2010i2p687-724.html)).

Politicians themselves show no reliable edge in recent data. Senators' stock purchases beat the market by 85 basis points per month in 1993–1998 ([Ziobrowski et al.](https://ideas.repec.org/a/cup/jfinqa/v39y2004i04p661-676_00.html)). But members underperformed by 2–3% per year in 2004–2008 ([Eggers & Hainmueller](https://www.mit.edu/~jhainm/Paper/Eggmueller_CapitolLosses.pdf)). Using 2012–2020 disclosures, Belmont and colleagues found no superior returns, though they cannot rule out individual insider trades hidden in averages ([NBER w26975](https://www.nber.org/papers/w26975.pdf)).

Markets also charge for political uncertainty. Equity options that span national elections or global summits cost more, especially in weak economies ([Kelly, Pástor & Veronesi](https://www.nber.org/papers/w19812.pdf)). The Economic Policy Uncertainty index, built from newspaper word counts, tracks this uncertainty and is free to use ([Baker, Bloom & Davis](https://users.ssc.wisc.edu/~mchinn/bakerbloomdavis_QJE2016.pdf)).

### Forecasters start from base rates, then add people and signals

**The workhorse method has three steps: a base rate, then the positions of the actors, then case-specific signals.** The result is then compared with a market price, such as a merger spread or a prediction-market contract.

Base rates come first because many policy events are rare. Only **about 4–6% of bills introduced in Congress become law**, so a model that never predicts enactment scores about 96% "accuracy". That is why forecasters judge models with probability scores instead ([Vanderbilt Engineering](https://engineering.vanderbilt.edu/news/2017/john-nay-ai-predictgov/); [Nay, PLOS ONE](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5425031/)). For drug approvals, the FDA followed its advisory committee's vote **88% of the time** across 409 meetings; most surprises were approvals after a "no" vote ([JAMA Health Forum](https://jamanetwork.com/journals/jama-health-forum/fullarticle/2807050)).

Legislative models add bill text and context. Yano, Smith and Wilkerson showed that bill wording improves predictions of which bills survive committee ([ACL Anthology](https://aclanthology.org/N12-1097/)). Nay's model, which combines text with context such as the sponsor's party, beat either alone across 2001–2015 ([PLOS ONE](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5425031/)). Commercial tools build on this. Westlaw Edge's "Probability of Enactment", using Skopos Labs technology, weighs more than 250 factors ([ABA Journal](https://abajournal.com/news/article/new-feature-in-westlaw-edge-predicts-legislative-outcomes)). FiscalNote added AI bill forecasts in June 2025 ([BusinessWire](https://www.businesswire.com/news/home/20250612678578/en/FiscalNote-Accelerates-AI-Innovation-with-New-Enhancements-to-PolicyNote-for-Legislative-Forecasting-Alerts-and-Bill-Discovery)). No peer-reviewed accuracy study of these commercial tools was found.

Actor positions come from ideal-point models. NOMINATE estimates each legislator's position from roll-call votes and remains the most popular method ([Voteview primer](https://legacy.voteview.com/pdf/nominate_and_political_history_primer.pdf)).

Courts show how far simple models can go. For the Supreme Court's 2002 term, a statistical model predicted **75%** of outcomes correctly versus **59.1%** for legal experts; its edge came from predicting the swing justices ([Ruger et al.](https://openscholarship.wustl.edu/law_scholarship/464)). A random-forest model trained on two centuries of cases reached **70.2%** ([Katz, Bommarito & Blackman](https://arxiv.org/abs/1612.03473v2)).

Stale data is a common trap. When Medicare picked the first ten drugs for price negotiation in 2023, **four of them appeared on none of five analysts' lists**. The analysts used old public spending data, while the agency used newer non-public data ([DLA Piper](https://www.dlapiper.com/insights/publications/2023/09/cms-selects-ten-drugs-for-inflation-reduction-act)). In later rounds, one team reportedly named 13 of 15 drugs correctly (secondary source) ([BioXconomy](https://www.bioxconomy.com/pricing-and-contracting/medicare-names-2028-drug-list-with-two-surprises)).

For antitrust, merger-arbitrage funds read deal spreads as implied odds that regulators will allow a deal. In 2023 one fund manager cited implied odds of about 60% for Capri/Tapestry versus about 10% for Albertsons/Kroger ([Carmignac](https://www.carmignac.com/es/articulos/carmignac-merger-arbitrage-letter-from-the-portfolio-managers-3102-10700)). The final outcomes of those two deals were not verified in the notes.

Formal "actor models" exist but lack independent checks. Bruce Bueno de Mesquita's model asks experts for each stakeholder's preferred outcome, influence and how much they care, then simulates bargaining. A former CIA analyst said it was "accurate 90 percent of the time" ([Foreign Policy](https://foreignpolicy.com/2007/10/14/bdm-in-profile/)). That figure is self-reported and has never been independently audited.

### Trained crowds and prediction markets beat most experts

**Well-run crowds beat most individual experts, and since 2024 US prediction markets have become a major, regulated source of political probabilities.**

Tetlock tracked about 284 experts over roughly 20 years and found most did no better than simple algorithms ([Jason Collins review](https://corporate.jasoncollins.blog/expert-political-judgment)). In a US intelligence-funded tournament, the Good Judgment Project won by **training** forecasters in base-rate thinking, **teaming** them, and **tracking** the best into "superforecaster" teams ([Mellers et al.](https://www.psychologicalscience.org/journals/psychological-science/0956797614524255/)). A 2024 reanalysis argues the training and teaming effects shrink once other factors are controlled ([APS](https://www.psychologicalscience.org/journals/psychological-science/09567976241266481/)). The popular claim that superforecasters beat intelligence analysts by about 30% comes from press reporting and should be treated as approximate. A long-standing review found prediction markets "typically fairly accurate" and better than most benchmarks ([Wolfers & Zitzewitz](https://www.csc2.ncsu.edu/faculty/mpsingh/local/Social/f15/wrap/readings/Wolfers+Zitzewitz-Prediction-Markets.pdf)).

The US market changed fast. In September 2024 a judge ruled the CFTC (the US derivatives regulator) could not block Kalshi's election contracts, and the CFTC dropped its appeal in May 2025 ([Covers](https://www.covers.com/industry/kalshi-cftc-lawsuit-appeal-election-betting-contracts-drop-may-2025)). Polymarket re-entered the US by buying a regulated exchange for $112 million ([Crypto Briefing](https://cryptobriefing.com/polymarket-secures-cftc-nod-us-market-qcx-llc-acquisition-2/)); sources conflict on its exact relaunch date. Kalshi was valued at $11 billion in November 2025 ([TechCrunch](https://techcrunch.com/2025/11/20/source-kalshis-valuation-jumps-to-11b-after-raising-massive-1b-round)), and by May 2026 platforms were courting hedge funds ([Reuters via KELO](https://kelo.com/2026/05/27/prediction-markets-look-to-institutional-investors-for-next-phase-of-growth/)).

Insider trading moved onto these venues too. In January 2026 a new Polymarket account made about **$436,760** betting that Venezuela's Maduro would be out by month-end ([Axios](https://www.axios.com/2026/01/05/venezuela-polymarket-prediction-insider-trading)). A US special-forces soldier was later charged with using classified information to bet on that capture. On 30 April 2026 the Senate banned senators and staff from betting on prediction markets ([PBS NewsHour](https://www.pbs.org/newshour/politics/senate-bans-members-and-staff-from-betting-in-prediction-markets)).

Funds plausibly use these markets as a free probability feed, a hedge for binary political risks, and a trading opportunity. No primary source named a specific hedge fund doing so.

### Alternative data shows whether a policy actually bites

**For policy, "alternative data" works on three timescales:** slow structural data to set starting beliefs, trackers and text models to update them, and fast "tells" for timing.

Trackers such as FiscalNote, Quorum and Westlaw Edge follow bills and rules. Public comments on proposed regulations matter for their content, not their number: "the public comment process is not a vote" ([Regulations.gov guide](https://www.regulations.gov/assets/files/Public-Comment-on-Federal-Regulations_Final.pdf)). Officials' own posts can act as tells, as Trump's April 2025 "buy" post did.

For sanctions, the question is often whether they bite, not whether they are imposed. Ship-tracking firms flagged Russian tankers switching off their location transponders after 2022 ([Claims Journal/Bloomberg](https://www.claimsjournal.com/news/international/2022/03/29/309507.htm)), and satellite imagery helps find them ([Planet](https://www.planet.com/pulse/planets-data-leveraged-to-identify-dark-vessels-and-monitor-the-illicit-russian-oil-trade)).

Private polling is a controversial class of its own. Around the 2016 Brexit vote, hedge funds bought private polls, including on-the-day exit polls, from at least six firms. This was legal as long as results were not published before polls closed ([Bloomberg via BQ](https://www.bloombergquint.com/politics/u-k-lawmaker-says-secret-hedge-fund-brexit-polling-a-scandal)).

### Big one-off political events produce shared misses

**Polls, models and betting markets miss together on one-off political events, because they all lean on the same polls.** Systematic models do much better on frequent, structured decisions.

| Event | What forecasters said | What happened | Lesson | Source |
|---|---|---|---|---|
| Brexit, 23 June 2016 | Betfair gave Remain up to 94% on polling day | Leave won; the pound fell from above $1.50 to about $1.32 | Shared polling error; funds with private exit polls had an edge | [SBC News](https://sbcnews.co.uk/europe/2016/06/24/brexit-breaks-betting-records-bettors-left-shocked/); [News Letter](https://www.newsletter.co.uk/business/pollsters-under-fire-over-hedge-fund-brexit-bets-572972) |
| US election 2016 | Clinton win: FiveThirtyEight 71.4%, Upshot about 85%, HuffPost 98.2% | Trump won | The most cautious forecast was penalised least | [UC Press](https://www.ucpress.edu/blog-posts/52591-lost-in-a-gallup-revisiting-the-final-hours-of-the-2016-campaign) |
| US election 2024 | Polymarket leaned Trump; the AI-poll startup Aaru called Harris | Trump won | The market was right; the synthetic AI poll was wrong | [The Block](https://www.theblock.co/post/324996/polymarket-whale-us-election-profit-france-ban); [Semafor](https://semafor.com/article/11/04/2024/an-ai-polling-startup-polls-bots-predicts-harris-will-win) |
| US tariffs, April 2025 | Stated policy pointed to lasting tariffs | S&P 500 fell almost 14% in under a week, then rose about 9.5% on the 9 April pause | Modelling the decision-maker's tolerance for market pain mattered more than stated policy | [Alaska Beacon](https://alaskabeacon.com/2025/04/09/repub/trump-sets-90-day-pause-on-many-tariffs-hikes-china-to-125/) |
| Medicare drug selection, 2023 | Five analyst lists | Four chosen drugs were on no list | Models built on stale public data fail | [DLA Piper](https://www.dlapiper.com/insights/publications/2023/09/cms-selects-ten-drugs-for-inflation-reduction-act) |
| Supreme Court | Models 70–75% | Experts 59% | Structured, repeated decisions model well | [Ruger et al.](https://openscholarship.wustl.edu/law_scholarship/464) |

Forecast quality should be judged over many forecasts, with a probability score, not by single headline calls. A 71% forecast that "misses" is not necessarily wrong. FiveThirtyEight's 71.4% for Clinton has a Brier score of about 0.51; a 99% forecast scores about 0.98, almost twice as bad.

The pattern since 2025 suggests the forecasting edge has shifted. It has moved away from Congress-focused insight (vote counts, committee staff) toward reading the executive branch (presidential statements, deadlines, market-pain thresholds, court challenges) and toward prediction markets, which can carry leaked information.

### Core papers behind Part 1

**Central banks**

| Citation | Status | One-line takeaway |
|---|---|---|
| Piazzesi & Swanson (2008). "Futures Prices as Risk-Adjusted Forecasts of Monetary Policy." *Journal of Monetary Economics* 55: 677–691. [NBER w10547](https://www.nber.org/papers/w10547.pdf) | Peer-reviewed | Futures contain risk premia that bias raw forecasts. |
| Schmeling, Schrimpf & Steffensen (2022). "Monetary Policy Expectation Errors." *Journal of Financial Economics* 146(3): 841–858. [BIS WP 996](https://www.bis.org/publ/work996.pdf) | Peer-reviewed | Markets underestimate how far the Fed cuts in downturns. |
| Gürkaynak, Sack & Swanson (2007). "Market-Based Measures of Monetary Policy Expectations." *Journal of Business & Economic Statistics* 25(2). [DOI](https://doi.org/10.1198/073500106000000387) | Peer-reviewed (not re-checked) | Fed funds futures are the best market predictor a few months out. |
| Diercks, Katz & Wright (2026). "Kalshi and the Rise of Macro Markets." FEDS 2026-010; NBER w34702. [Fed page](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm) | Working paper | Kalshi had a perfect day-before record on Fed decisions. |
| Engstrom (2026). "Anchored to the Dot Plot: Central Bank Projections and Interest Rate Expectations." FEDS 2026-026. [Fed page](https://www.federalreserve.gov/econres/feds/anchored-to-the-dot-plot-central-bank-projections-and-interest-rate-expectations.htm) | Working paper | Dots forecast well but anchor forecasters to stale views. |
| Bauer & Swanson (2022). "A Reassessment of Monetary Policy Surprises and High-Frequency Identification." *NBER Macroeconomics Annual* 37. [NBER](https://www.nber.org/papers/w29939) | Peer-reviewed | Fed surprises are partly predictable from public data. |
| Hansen, McMahon & Prat (2018). "Transparency and Deliberation within the FOMC: A Computational Linguistics Approach." *Quarterly Journal of Economics* 133(2): 801–870. [DOI](https://doi.org/10.1093/qje/qjx045) | Peer-reviewed | Topic models of transcripts show how transparency changed debate. |
| Aruoba & Drechsel (2024). "Identifying Monetary Policy Shocks: A Natural Language Approach." NBER WP 32417. [NBER](https://www.nber.org/papers/w32417) | Working paper (listed as forthcoming in *AEJ: Macro*) | Staff documents' text predicts decisions beyond numbers. |
| Shah, Paturi & Chava (2023). "Trillion Dollar Words: A New Financial Dataset, Task & Market Analysis." *ACL 2023*. [DOI](https://doi.org/10.18653/v1/2023.acl-long.368) | Peer-reviewed | The standard hawkish/dovish FOMC dataset. |
| Hansen & Kazinnik (2023/2024). "Can ChatGPT Decipher Fedspeak?" SSRN / Richmond Fed. [FRBSF/Richmond Fed](https://www.frbsf.org/research-and-insights/publications/system-research-richmond-fed/2024/03/can-chatgpt-decipher-fedspeak/) | Working paper | GPT classifies Fed stance better than older methods. |
| Gambacorta, Kwon, Park, Patelli & Zhu (2024). "CB-LMs: Language Models for Central Banking." BIS WP 1215. [BIS](https://www.bis.org/publ/work1215.htm) | Working paper | Central-bank-specific models can beat general LLMs. |
| Peskoff, Visokay, Schulhoff, Wachspress, Blinder & Stewart (2023). "GPT Deciphering Fedspeak: Quantifying Dissent Among Hawks and Doves." *Findings of EMNLP 2023*. [DOI](https://doi.org/10.18653/v1/2023.findings-emnlp.434) | Peer-reviewed | Member-level hawk/dove dissent measured with GPT. |
| Gorodnichenko, Pham & Talavera (2023). "The Voice of Monetary Policy." *American Economic Review* 113(2): 548–584. [DOI](https://doi.org/10.1257/aer.20220129) | Peer-reviewed | Vocal tone moves markets beyond words. |
| Curti & Kazinnik (2023). "Let's Face It: Quantifying the Impact of Nonverbal Communication in FOMC Press Conferences." *Journal of Monetary Economics* 139: 110–126. [RePEc](https://ideas.repec.org/a/eee/moneco/v139y2023icp110-126.html) | Peer-reviewed | Negative facial expressions lower stocks. |
| Bordo & Istrefi (2023). "Perceived FOMC: The Making of Hawks, Doves and Swingers." *Journal of Monetary Economics*. [NBER w24650](https://www.nber.org/papers/w24650) | Peer-reviewed | Classifies each FOMC member since the 1960s. |
| Lucca & Moench (2015). "The Pre-FOMC Announcement Drift." *Journal of Finance* 70: 329–371. [NY Fed SR512](https://www.newyorkfed.org/research/staff_reports/sr512.html) | Peer-reviewed | Stocks rose 49 bp before announcements (until about 2015). |
| Cieslak, Morse & Vissing-Jorgensen (2019). "Stock Returns over the FOMC Cycle." *Journal of Finance* 74(5): 2201–2248. [SSRN](https://papers.ssrn.com/abstract=2687614) | Peer-reviewed | Equity premium earned in "even weeks"; informal communication. |
| Bernile, Hu & Tang (2016). "Can Information Be Locked Up? Informed Trading Ahead of Macro-News Announcements." *Journal of Financial Economics* 121(3): 496–520. [SMU](https://ink.library.smu.edu.sg/lkcsb_research/4229) | Peer-reviewed | Informed trading during FOMC lock-ups. |
| Ehrmann, Gnan & Rieder (2023). "Central Bank Communication by 'Sources': The Economics of Public Policy Leaks." ECB WP 2846. [ECB](https://www.ecb.europa.eu/pub/pdf/scpwps/ecb.wp2846~30dc1682a8.en.pdf) | Working paper | 368 ECB leaks moved markets more than official remarks. |

**Politics, law and regulation**

| Citation | Status | One-line takeaway |
|---|---|---|
| US GAO (2013). "Political Intelligence: Financial Market Value of Government Information Hinges on Materiality and Timing." GAO-13-389. [GAO](https://www.gao.gov/products/gao-13-389) | Government report | No law specifically governs political intelligence. |
| Gao, M. & Huang, J. (2016). "Capitalizing on Capitol Hill: Informed trading by hedge fund managers." *Journal of Financial Economics* 121(3): 521–545. [Summary](https://corpgov.law.harvard.edu/2016/08/26/capitalizing-on-capitol-hill-informed-trading-by-hedge-fund-managers/) | Peer-reviewed | Lobbyist-linked funds beat benchmarks until the STOCK Act. |
| Cooper, M.J., Gulen, H. & Ovtchinnikov, A.V. (2010). "Corporate Political Contributions and Stock Returns." *Journal of Finance* 65(2): 687–724. [RePEc](https://ideas.repec.org/a/bla/jfinan/v65y2010i2p687-724.html) | Peer-reviewed | Political contributions predict returns. |
| Kelly, B., Pástor, Ľ. & Veronesi, P. (2016). "The Price of Political Uncertainty: Theory and Evidence from the Option Market." *Journal of Finance* 71(5): 2417–2480. [NBER w19812](https://www.nber.org/papers/w19812.pdf) | Peer-reviewed | Options spanning elections cost more. |
| Baker, S.R., Bloom, N. & Davis, S.J. (2016). "Measuring Economic Policy Uncertainty." *Quarterly Journal of Economics* 131(4). [PDF](https://users.ssc.wisc.edu/~mchinn/bakerbloomdavis_QJE2016.pdf) | Peer-reviewed | The newspaper-based policy uncertainty index. |
| Ziobrowski, A.J., Cheng, P., Boyd, J.W. & Ziobrowski, B.J. (2004). "Abnormal Returns from the Common Stock Investments of the U.S. Senate." *Journal of Financial and Quantitative Analysis* 39(4): 661–676. [RePEc](https://ideas.repec.org/a/cup/jfinqa/v39y2004i04p661-676_00.html) | Peer-reviewed | Senators beat the market in 1993–1998. |
| Eggers, A.C. & Hainmueller, J. (2013). "Capitol Losses: The Mediocre Performance of Congressional Stock Portfolios." *Journal of Politics* 75(2). [PDF](https://www.mit.edu/~jhainm/Paper/Eggmueller_CapitolLosses.pdf) | Peer-reviewed | Members underperformed in 2004–2008. |
| Belmont, W., Sacerdote, B., Sehgal, R. & Van Hoek, I. (2022). "Do Senators and House Members Beat the Stock Market? Evidence from the STOCK Act." *Journal of Public Economics* 207: 104602. [NBER w26975](https://www.nber.org/papers/w26975.pdf) | Peer-reviewed | No superior returns in 2012–2020. |
| Yano, T., Smith, N.A. & Wilkerson, J.D. (2012). "Textual Predictors of Bill Survival in Congressional Committees." *NAACL-HLT 2012*: 793–802. [ACL Anthology](https://aclanthology.org/N12-1097/) | Peer-reviewed | Bill text predicts committee survival. |
| Nay, J.J. (2017). "Predicting and understanding law-making with word vectors and an ensemble model." *PLOS ONE* 12(5): e0176999. [DOI](https://doi.org/10.1371/journal.pone.0176999) | Peer-reviewed | Text plus context best predicts enactment. |
| Poole, K.T. & Rosenthal, H. (1985). "A Spatial Model for Legislative Roll Call Analysis." *American Journal of Political Science* 29(2): 357–384. [Caltech](https://authors.library.caltech.edu/83232/) | Peer-reviewed | NOMINATE ideal points. |
| Ruger, T.W., Kim, P.T., Martin, A.D. & Quinn, K.M. (2004). "The Supreme Court Forecasting Project." *Columbia Law Review* 104: 1150. [WashU](https://openscholarship.wustl.edu/law_scholarship/464) | Peer-reviewed | Model 75% vs experts 59.1%. |
| Katz, D.M., Bommarito, M.J. & Blackman, J. (2017). "A general approach for predicting the behavior of the Supreme Court of the United States." *PLOS ONE* 12(4): e0174698. [DOI](https://doi.org/10.1371/journal.pone.0174698) | Peer-reviewed | About 70% across two centuries. |
| Daval, Teng, Russo & Kesselheim (2023). Study of FDA actions after drug advisory committee votes, 2010–2021. *JAMA Health Forum* 4(7): e231718. [JAMA](https://jamanetwork.com/journals/jama-health-forum/fullarticle/2807050) | Peer-reviewed | FDA follows its advisers 88% of the time. |
| Wolfers, J. & Zitzewitz, E. (2004). "Prediction Markets." *Journal of Economic Perspectives* 18(2): 107–126. [PDF](https://www.csc2.ncsu.edu/faculty/mpsingh/local/Social/f15/wrap/readings/Wolfers+Zitzewitz-Prediction-Markets.pdf) | Peer-reviewed | Prediction markets are usually accurate. |
| Tetlock, P.E. (2005). *Expert Political Judgment: How Good Is It? How Can We Know?* Princeton University Press. [Review](https://corporate.jasoncollins.blog/expert-political-judgment) | Book | Most experts do no better than simple algorithms. |
| Mellers, B. et al. (2014). "Psychological Strategies for Winning a Geopolitical Forecasting Tournament." *Psychological Science* 25(5): 1106–1115. [APS](https://www.psychologicalscience.org/journals/psychological-science/0956797614524255/) | Peer-reviewed | Training, teaming and tracking improve forecasts (later contested). |

# Part 2. The Park et al. paper and AI simulation of decision-makers

## 3. Park et al.: agents built from self-reports match people 83–86% as well as people match themselves

**Park and colleagues showed that an LLM agent given one real person's own words predicts that person's survey answers much better than an agent given only demographics.** The newest version is more modest than the 2024 preprint. The gains are smallest for real-money behaviour, and the agents exaggerate the size of experimental effects.

The paper: Park, Zou, Kamphorst, Egan, Shaw, Hill, Cai, Morris, Willer, Liang & Bernstein, "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals." It exists as a manuscript formatted for *Nature* ([PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)) and as arXiv:2411.10109 version 3, dated 28 June 2026 ([arXiv v3](https://arxiv.org/abs/2411.10109v3)). The first version, from November 2024, was titled "Generative Agent Simulations of 1,000 People" ([arXiv v1](https://arxiv.org/abs/2411.10109v1)). **Publication in *Nature* could not be confirmed as of October 2026**; Stanford's project page still lists it as a working paper ([Stanford AI4PB](https://ai4pb.stanford.edu/projects/generative-agent-simulations-of-1%2C000-people)).

### What the study did

The team recruited **1,052 US adults**, chosen to roughly match the US population on age, gender, race, region, education and party. Each person did a voice interview of **about two hours with an AI interviewer**, averaging 6,491 words of transcript. The interview followed the American Voices Project protocol, an existing set of life-story and social-issue questions, so it was not tailored to the tests ([Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)).

Participants then completed four tests: the General Social Survey (GSS, a long-running US attitudes survey), a 44-item personality test (the Big Five), five money games such as the trust game and prisoner's dilemma, and five published psychology experiments. **Two weeks later they did all four again.** That repeat measures how consistent each person is with themselves.

The team built five kinds of agent for each person: one given the full interview transcript; one given the person's survey answers (with the tested question held out); one given both; one given only age, gender, race and political ideology; and one given a short paragraph the person wrote about themselves.

### What it found

**Grounded agents clearly beat demographic agents on attitudes, and do less well on real-money behaviour.**

| Agent built from | Survey attitudes (GSS) | Personality (Big Five) | Money games |
|---|---|---|---|
| Two-hour interview | **0.83** | 0.80 | 0.66 |
| Survey answers | 0.82 | 0.65 | 0.38 |
| Interview + survey | **0.86** | 0.77 | 0.49 |
| Demographics only | 0.74 | 0.61 | not reported in notes |
| Self-written paragraph | 0.71 | 0.75 | not reported in notes |

*GSS figures are normalized accuracy; Big Five and games are normalized correlation. 1.0 means "as good as the person repeating their own answers two weeks later." Source: [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf).*

"83%" does not mean the agent gets 83% of answers right. **Raw accuracy was about 66%**, while people matched their own earlier answers only about 80% of the time; 66 divided by 80 gives 0.83. Random guessing would score about 30%.

The information matters, not the exact wording. Deleting a random 80% of each transcript still gave 0.79 on the GSS, and agents given only bullet-point summaries scored 0.84. A new analysis found agents both look up answers the person said directly and infer answers the person never gave.

Agents get the direction of experiments right but exaggerate their size. Agent-estimated effects correlated with real human effects at **r = 0.91–0.99**. But in one study the effect size was **2.97 for interview agents versus 0.36 for humans**. In another case, demographic and survey agents "found" an effect that the human replication did not.

Grounding also made agents fairer across political groups. The accuracy gap between the best- and worst-predicted ideological group **fell from 13.75% for demographic agents to 8.60% for interview agents** on the GSS.

The team released aggregated data and open-source code, plus more than 3,000 demographic-only agents built from public GSS data. Individual interview-based agents are available only on request after an ethics review, for privacy reasons ([GitHub](https://github.com/joonspk-research/genagents)). The authors list near-term uses as research tools: studying differences between people, refining surveys, "mixed subjects" designs and pilot-testing experiments.

### The 2026 version walked back several 2024 claims

**The newer version is substantively different, not just retitled.** Anyone quoting the widely reported "85%" figure from 2024 is quoting an outdated number.

| Topic | 2024 preprint (v1) | 2026 version |
|---|---|---|
| Title and authors | "Generative Agent Simulations of 1,000 People"; 9 authors | New title; adds Jonne Kamphorst and Niles Egan |
| Headline GSS score | 0.85 on 177 questions | 0.83 on 150 questions, after removing 27 that overlapped with the interview |
| Interviews vs surveys | "Interviews are more effective and efficient than survey-based methods" (tested on only 100 people) | Survey agents score 0.82, nearly equal to interviews; combining gives "modest" gains that "begin to asymptote" |
| Experiment effects | Stressed the 0.98 correlation | Adds that agent effects "were larger than" human ones and the design is "underpowered" |
| Framing | "Broad applications in policymaking and social science" | Research tools; policymaking claims toned down |

Sources: [arXiv v1](https://arxiv.org/abs/2411.10109v1); [arXiv v3](https://arxiv.org/abs/2411.10109v3); [Nature MS PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf).

The practical message of the change: a well-chosen structured survey about a person gets nearly as far as a two-hour interview. That matters for policy work, because you cannot interview a Fed governor for two hours.

### What the paper does not tell us

The *Nature* main text does not name the LLM that powers the agents; the 2024 version used GPT-4o. The tests (GSS, Big Five) are classic instruments that are well represented in LLM training data, which may flatter accuracy compared with new or unusual questions. And none of the instruments measures elite or institutional decision-making. They measure members of the public answering standard questions.

## 4. The paper positions itself between "silicon samples" and outcome-specific machine learning

**Park et al.'s 66 references show what the paper is pushing against.** On one side is "silicon sampling": prompting an LLM with a demographic label, which critics say produces stereotypes. On the other is machine learning trained for one specific outcome, which needs large labelled datasets and still predicts life outcomes poorly. The paper offers a middle path: ground each agent in one individual's own data, then let a general-purpose LLM infer the rest.

Two cited preprints have since been published in major journals: Ashokkumar et al. in *Nature* (2026) and Wang et al. in *Nature Machine Intelligence* (2025). Neither version of the paper cites Aher et al. (2023), Dillion et al. (2023), Bisbee et al. (2024) or the large replication studies; those appear in Section 5. Reference numbers [n] below are from the *Nature* manuscript ([PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)). The tag **[POLICY]** marks works most relevant to predicting policy decisions or reactions to policy.

**The authors' own earlier agent work**

| Ref | Citation | Status | Why it matters |
|---|---|---|---|
| [10] | Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P. & Bernstein, M.S. (2023). "Generative Agents: Interactive Simulacra of Human Behavior." *UIST '23*, 1–22. [doi:10.1145/3586183.3606763](https://doi.org/10.1145/3586183.3606763) | Peer-reviewed | The "Smallville" paper; introduced the memory, reflection and planning design these agents build on. |
| [31] | Park, J.S., Popowski, L., Cai, C., Morris, M.R., Liang, P. & Bernstein, M.S. (2022). "Social Simulacra: Creating Populated Prototypes for Social Computing Systems." *UIST '22*, 1–18. [doi:10.1145/3526113.3545616](https://doi.org/10.1145/3526113.3545616) | Peer-reviewed | Earlier persona simulation; source of the "persona" baseline. |

**LLMs as stand-ins for survey respondents and experiment subjects**

| Ref | Citation | Status | Why it matters |
|---|---|---|---|
| [2] | Argyle, L.P., Busby, E.C., Fulda, N., Gubler, J.R., Rytting, C. & Wingate, D. (2023). "Out of One, Many: Using Language Models to Simulate Human Samples." *Political Analysis* 31: 337–351. [doi:10.1017/pan.2023.2](https://doi.org/10.1017/pan.2023.2) | Peer-reviewed | The founding "silicon sampling" paper: demographic backstories reproduce group-level vote choice. **[POLICY]** |
| [50] | Horton, J.J. (2023). "Large Language Models as Simulated Economic Agents: What Can We Learn from Homo Silicus?" [arXiv:2301.07543](https://arxiv.org/abs/2301.07543) | Preprint | LLMs reproduce classic behavioural-economics results. |
| [35] | Santurkar, S., Durmus, E., Ladhak, F., Lee, C., Liang, P. & Hashimoto, T. (2023). "Whose Opinions Do Language Models Reflect?" *ICML 2023*. [arXiv:2303.17548](https://arxiv.org/abs/2303.17548) | Peer-reviewed | Default LLM opinions differ from many US groups. |
| [1] | Ashokkumar, A., Hewitt, L., Ghezae, I. & Willer, R. (2026). "Large language models can predict the results of social science experiments." *Nature* 656: 115–122. [doi:10.1038/s41586-026-10742-x](https://doi.org/10.1038/s41586-026-10742-x) | Peer-reviewed (cited as a 2024 preprint) | GPT-4 predictions of 469 effects from 70 survey experiments track real effects but overestimate their size. **[POLICY]** |
| [3] | Toubia, O., Gui, G.Z., Peng, T., Merlau, D.J., Li, A. & Chen, H. (2025). "Twin-2K-500: A Data Set for Building Digital Twins of over 2,000 People Based on Their Answers to over 500 Questions." *Marketing Science* 44: 1446–1455. [doi:10.1287/mksc.2025.0262](https://doi.org/10.1287/mksc.2025.0262) | Peer-reviewed | The main open dataset for individual digital twins. |
| [5] | Li, P., Castelo, N., Katona, Z. & Sarvary, M. (2024). "Frontiers: Determining the Validity of Large Language Models for Automated Perceptual Analysis." *Marketing Science* 43: 254–266. [doi:10.1287/mksc.2023.0454](https://doi.org/10.1287/mksc.2023.0454) | Peer-reviewed | LLMs reproduce consumer perception maps. |
| [6] | Binz, M. & Schulz, E. (2023). "Using cognitive psychology to understand GPT-3." *PNAS* 120(6): e2218523120. [doi:10.1073/pnas.2218523120](https://doi.org/10.1073/pnas.2218523120) | Peer-reviewed | Classic psychology tasks run on GPT-3. |
| [7] | Cui, Z., Li, N. & Zhou, H. (2025). "A large-scale replication of scenario-based experiments in psychology and management using large language models." *Nature Computational Science* 5: 627–634. [doi:10.1038/s43588-025-00840-7](https://doi.org/10.1038/s43588-025-00840-7) | Peer-reviewed | LLMs replicate many vignette experiments, with some failures. |
| [8] | Anthis, J.R., Liu, R., Richardson, S.M., Kozlowski, A.C., Koch, B., Evans, J., Brynjolfsson, E. & Bernstein, M. (2025). "LLM Social Simulations Are a Promising Research Method." [arXiv:2504.02234](https://arxiv.org/abs/2504.02234) | Preprint (position paper) | Names five challenges: diversity, bias, sycophancy, alienness, generalisation. |
| [12] | Qu, Y. & Wang, J. (2024). "Performance and biases of Large Language Models in public opinion simulation." *Humanities and Social Sciences Communications* 11: 1095. [doi:10.1057/s41599-024-03609-x](https://doi.org/10.1057/s41599-024-03609-x) | Peer-reviewed | Worse accuracy outside the US and for some groups. **[POLICY]** |
| [13] | Boelaert, J., Coavoux, S., Ollion, É., Petev, I. & Präg, P. (2025). "Machine Bias. How Do Generative Language Models Answer Opinion Polls?" *Sociological Methods & Research* 54: 1156–1196. [doi:10.1177/00491241251330582](https://doi.org/10.1177/00491241251330582) | Peer-reviewed | LLM answers show a "machine bias" with too little variety. |
| [14] | Broska, D., Howes, M. & van Loon, A. (2025). "The Mixed Subjects Design: Treating Large Language Models as Potentially Informative Observations." *Sociological Methods & Research* 54: 1074–1109. [doi:10.1177/00491241251326865](https://doi.org/10.1177/00491241251326865) | Peer-reviewed | A statistical method for combining a few humans with many AI "subjects" without bias. |

**Warnings about stereotypes and false confidence**

| Ref | Citation | Status | Why it matters |
|---|---|---|---|
| [11] | Wang, A., Morgenstern, J. & Dickerson, J.P. (2025). "Large language models that replace human participants can harmfully misportray and flatten identity groups." *Nature Machine Intelligence* 7: 400–411. [doi:10.1038/s42256-025-00986-z](https://doi.org/10.1038/s42256-025-00986-z) | Peer-reviewed (cited as a 2024 preprint) | Identity-prompted LLMs portray groups as outsiders see them. The main motivation for grounding. |
| [20] | Cheng, M., Piccardi, T. & Yang, D. (2023). "CoMPosT: Characterizing and Evaluating Caricature in LLM Simulations." *EMNLP 2023*: 10853–10875. [doi:10.18653/v1/2023.emnlp-main.669](https://doi.org/10.18653/v1/2023.emnlp-main.669) | Peer-reviewed | Measures how simulations exaggerate stereotypes. |
| [34] | Messeri, L. & Crockett, M.J. (2024). "Artificial intelligence and illusions of understanding in scientific research." *Nature* 627: 49–58. [doi:10.1038/s41586-024-07146-0](https://doi.org/10.1038/s41586-024-07146-0) | Peer-reviewed | AI stand-ins can create false confidence in science. |

**Predicting life outcomes with machine learning (the approach the paper contrasts itself with)**

| Ref | Citation | Status | Why it matters |
|---|---|---|---|
| [9] | Salganik, M.J., Lundberg, I., Kindel, A.T., et al. (2020). "Measuring the predictability of life outcomes with a scientific mass collaboration." *PNAS* 117: 8398–8403. [doi:10.1073/pnas.1915006117](https://doi.org/10.1073/pnas.1915006117) | Peer-reviewed | 160 teams with rich data predicted life outcomes poorly. |
| [15] | Lundberg, I., Brown-Weinstock, R., Clampet-Lundquist, S., et al. (2024). "The origins of unpredictability in life outcome prediction tasks." *PNAS* 121: e2322973121. [doi:10.1073/pnas.2322973121](https://doi.org/10.1073/pnas.2322973121) | Peer-reviewed | Uses interviews to explain why outcomes are unpredictable. |
| [4] | Verhagen, M.D., Stroebl, B., Liu, T., Liu, L.T. & Salganik, M.J. (2025). "The Book of Life approach: Enabling richness and scale for life course research." [arXiv:2507.03027](https://arxiv.org/abs/2507.03027) | Preprint | Turns registry data into text "life books" for LLMs. |
| [32] | Ansolabehere, S., Rodden, J. & Snyder, J.M. (2008). "The Strength of Issues: Using Multiple Measures to Gauge Preference Stability, Ideological Constraint, and Issue Voting." *APSR* 102: 215–232. [doi:10.1017/S0003055408080210](https://doi.org/10.1017/S0003055408080210) | Peer-reviewed | Single survey items are noisy; the reason to normalise by test–retest. **[POLICY]** |

**Measurement tools and the five replicated experiments**

| Ref | Citation | Status |
|---|---|---|
| [19], [59] | NORC, General Social Survey 2023 ([gss.norc.org](https://gss.norc.org)); Marsden, P.V., Smith, T.W. & Hout, M. (2020). "Tracking US Social Change Over a Half-Century: The General Social Survey at Fifty." *Annual Review of Sociology* 46: 109–134. [doi:10.1146/annurev-soc-121919-054838](https://doi.org/10.1146/annurev-soc-121919-054838) | Survey; peer-reviewed review |
| [18] | Stanford Center on Poverty and Inequality, American Voices Project. [Methodology](https://inequality.stanford.edu/avp/methodology) (URL as given in the paper; not separately verified) | Interview protocol |
| [33] | John, O.P. & Srivastava, S. (1999). "The Big Five trait taxonomy." In *Handbook of Personality* (2nd ed.), Guilford: 102–138. No DOI. | Book chapter |
| [21] | Forsythe, R., Horowitz, J.L., Savin, N.E. & Sefton, M. (1994). "Fairness in Simple Bargaining Experiments." *Games and Economic Behavior* 6: 347–369. [doi:10.1006/game.1994.1021](https://doi.org/10.1006/game.1994.1021) | Peer-reviewed (dictator game) |
| [22] | Berg, J., Dickhaut, J. & McCabe, K. (1995). "Trust, Reciprocity, and Social History." *Games and Economic Behavior* 10: 122–142. [doi:10.1006/game.1995.1027](https://doi.org/10.1006/game.1995.1027) | Peer-reviewed (trust game) |
| [23], [24], [63] | Ledyard (1995), public goods, in *Handbook of Experimental Economics*; Rapoport & Chammah (1965), *Prisoner's Dilemma*; Camerer (2003), *Behavioral Game Theory*. No DOIs checked. | Books and chapters |
| [25] | Ames, D.L. & Fiske, S.T. (2015). "Perceived intent motivates people to magnify observed harms." *PNAS* 112: 3599–3605. [doi:10.1073/pnas.1501592112](https://doi.org/10.1073/pnas.1501592112) | Peer-reviewed |
| [26] | Cooney, G., Gilbert, D.T. & Wilson, T.D. (2016). "When fairness matters less than we expect." *PNAS* 113: 11168–11171. [doi:10.1073/pnas.1606574113](https://doi.org/10.1073/pnas.1606574113) | Peer-reviewed |
| [27] | Halevy, N. & Halali, E. (2015). "Selfish third parties act as peacemakers by transforming conflicts and promoting cooperation." *PNAS* 112: 6937–6942. [doi:10.1073/pnas.1505067112](https://doi.org/10.1073/pnas.1505067112) | Peer-reviewed |
| [28] | Rai, T.S., Valdesolo, P. & Graham, J. (2017). "Dehumanization increases instrumental violence, but not moral violence." *PNAS* 114: 8511–8516. [doi:10.1073/pnas.1705238114](https://doi.org/10.1073/pnas.1705238114) | Peer-reviewed |
| [29] | Schilke, O., Reimann, M. & Cook, K.S. (2015). "Power decreases trust in social exchange." *PNAS* 112: 12950–12955. [doi:10.1073/pnas.1517057112](https://doi.org/10.1073/pnas.1517057112) | Peer-reviewed |

**Classic agent-based modelling (background)**

| Ref | Citation | Status |
|---|---|---|
| [40] | Schelling, T.C. (1971). "Dynamic models of segregation." *Journal of Mathematical Sociology* 1: 143–186. [doi:10.1080/0022250X.1971.9989794](https://doi.org/10.1080/0022250X.1971.9989794) | Peer-reviewed |
| [46] | Bonabeau, E. (2002). "Agent-based modeling: Methods and techniques for simulating human systems." *PNAS* 99 (suppl. 3): 7280–7287. [doi:10.1073/pnas.082080899](https://doi.org/10.1073/pnas.082080899) | Peer-reviewed |
| [47] | Macy, M.W. & Willer, R. (2002). "From Factors to Actors: Computational Sociology and Agent-Based Modeling." *Annual Review of Sociology* 28: 143–166. [doi:10.1146/annurev.soc.28.110601.141117](https://doi.org/10.1146/annurev.soc.28.110601.141117) | Peer-reviewed |
| [39] | Bruch, E. & Atwell, J. (2015). "Agent-Based Models in Empirical Social Research." *Sociological Methods & Research* 44: 186–221. [doi:10.1177/0049124113506405](https://doi.org/10.1177/0049124113506405) | Peer-reviewed |
| [43] | Carley, K.M. (1992). "Organizational Learning and Personnel Turnover." *Organization Science* 3: 20–46. [doi:10.1287/orsc.3.1.20](https://doi.org/10.1287/orsc.3.1.20) | Peer-reviewed |
| [41], [42], [44], [45], [48], [49] | Epstein & Axtell (1996) *Growing Artificial Societies*; Axtell (2000) "Why agents?"; Lustick (2002) PS-I, *JASSS* 5(3); Schelling (1978) *Micromotives and Macrobehavior*; von Neumann & Morgenstern (1944); McFadden (1974) conditional logit. No DOIs checked. | Books and working papers |

**Fairness, methods and engineering**

| Ref | Citation | Status / note |
|---|---|---|
| [36] | Hardt, M., Price, E. & Srebro, N. (2016). "Equality of Opportunity in Supervised Learning." *NeurIPS 29*. [arXiv:1610.02413](https://arxiv.org/abs/1610.02413) | Peer-reviewed; supports the group-gap fairness metric. Barocas, Hardt & Narayanan's *Fairness and Machine Learning* [37] is at [fairmlbook.org](https://fairmlbook.org). |
| [54] | Liu, N.F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F. & Liang, P. "Lost in the Middle: How Language Models Use Long Contexts." *TACL*. [doi:10.1162/tacl_a_00638](https://doi.org/10.1162/tacl_a_00638) | Peer-reviewed. LLMs under-use the middle of long prompts, which matters for 6,500-word transcripts. **Citation mismatch:** the paper says vol. 11, 1312–1327; Crossref lists vol. 12, 157–173 (2024). |
| [64] | Nosek, B.A., et al. (2015). "Promoting an open research culture." *Science* 348: 1422–1425. [doi:10.1126/science.aab2374](https://doi.org/10.1126/science.aab2374) | Peer-reviewed |
| [66] | Silver, N.C. & Dunlap, W.P. (1987). "Averaging correlation coefficients: Should Fisher's z transformation be used?" *Journal of Applied Psychology* 72: 146–148. [doi:10.1037/0021-9010.72.1.146](https://doi.org/10.1037/0021-9010.72.1.146) | Peer-reviewed |
| [38] | Stagnaro, M.N., Druckman, J., Berinsky, A.J., Arechar, A.A., Willer, R. & Rand, D. (2024). "Representativeness versus Response Quality: Assessing Nine Opt-In Online Survey Samples." OSF preprint. | Preprint; **link not verified** |
| [61], [62] | Schmitt et al. (2023), PsyArXiv; Strus & Cieciuch (2019), *Journal of Research in Personality* 82: 103844. | **Not verified** |

## 5. Follow-up work: AI twins capture averages but not individuals

**Work since Park et al. splits into a clear pattern: AI agents predict group averages and the direction of effects well, but predict individuals on new questions poorly.** The strongest reality check, "Digital Twins as Funhouse Mirrors", tested twins built from more than 500 answers per person across 19 preregistered studies and 164 outcomes. The twins were "only modestly more accurate than a homogeneous base LLM", with an **average correlation of just r = 0.20** with real individuals ([arXiv:2509.19088](https://arxiv.org/abs/2509.19088)).

Park's high individual-level numbers come from classic survey items that LLMs have seen many times in training. New or unusual questions are harder. Meanwhile, at the group level, a 2026 *Nature* paper confirmed that LLMs track the results of real survey experiments, while again overestimating effect sizes ([Ashokkumar et al.](https://doi.org/10.1038/s41586-026-10742-x)).

Works marked † are confirmed in the notes to cite Park et al. The rest are closely related. The citing-paper search used one index that leans toward arXiv preprints, so journal papers may be under-counted.

**Individual digital twins: datasets, benchmarks and reality checks**

| Citation | Status | Key finding |
|---|---|---|
| Peng, T., Gui, G., Brucks, M., Merlau, D.J., Fan, G.J., Ben Sliman, M., et al. (2025). "Digital Twins as Funhouse Mirrors: Five Key Distortions." [arXiv:2509.19088](https://arxiv.org/abs/2509.19088) | Preprint | Average r = 0.20 on new outcomes; five distortions: too little individuality, stereotyping, representation bias, ideological bias, hyper-rationality. **[POLICY]** |
| Moon, S., Abdulhai, M., Kang, M., Suh, J., Soedarmadji, W., Kohen Behar, E., et al. (2024). "Virtual Personas for Language Models via an Anthology of Backstories." [arXiv:2407.06576](https://arxiv.org/abs/2407.06576) | Preprint | Rich first-person backstories improve matches to Pew survey distributions; a cheaper analogue of interviews. |
| Hu, T. & Collier, N. (2024). "Quantifying the Persona Effect in LLM Simulations." [arXiv:2402.10811](https://arxiv.org/abs/2402.10811) | Preprint | Persona variables explain only a small share of variation. |
| Suh, J., Jahanparast, E., Moon, S., Kang, M. & Chang, S. (2025). "Language Model Fine-Tuning on Scaled Survey Data for Predicting Distributions of Public Opinions." [arXiv:2502.16761](https://arxiv.org/abs/2502.16761) | Preprint | Fine-tuning on survey data beats prompting for group opinion. **[POLICY]** |
| Suh, J., Moon, S. & Chang, S. (2025). "Graph-Based Alternatives to LLMs for Human Simulation." [arXiv:2511.02135](https://arxiv.org/abs/2511.02135) | Preprint | A simpler graph model matches or beats LLM simulators on closed-ended survey prediction. |
| Kinzinger, L. & Hartmann, J. (2026). "Synthetic Personalities: How Well Can LLMs Mimic Individual Respondents Using Socio-Economic Microdata?" [arXiv:2606.04592](https://arxiv.org/abs/2606.04592) | Preprint | Twins from German panel data reach 78.8% held-out accuracy, with diminishing returns. |
| Jia, M., Chen, Y., Sharma, D. & Diaz-Rodriguez, J. (2026). "When Can Digital Personas Reliably Approximate Human Survey Findings?" [arXiv:2605.10659](https://arxiv.org/abs/2605.10659) | Preprint | Personas help with distributions but not individuals or rare answers. |
| Wang, S., Hunt, K., Tang, S. & Joseph, K. (2026). "When Can LLM Digital Twins Reduce Human Measurement? From Behavioral Fidelity to Statistical Substitutability." [arXiv:2609.07987](https://arxiv.org/abs/2609.07987) | Preprint | Twins reproduce averages but say little about which individuals deviate. |
| Li, Y., Venkit, P.N., Pruksachatkun, Y. & Wu, C.-S. (2026). "InterviewSim: A Scalable Framework for Interview-Grounded Personality Simulation." [arXiv:2602.20294](https://arxiv.org/abs/2602.20294) | Preprint | Extends interview grounding. |
| Moon, S., Kang, M., Suh, J., Safdari, M. & Canny, J. (2026). "Identity, Cooperation and Framing Effects within Groups of Real and Simulated Humans." [arXiv:2601.16355](https://arxiv.org/abs/2601.16355) | Preprint | Social-dilemma games mixing real and simulated people. |
| Cross, L., Haber, N. & Yamins, D.L.K. (2025). "Validating Generative Agent-Based Models of Social Norm Enforcement: From Replication to Novel Predictions." [arXiv:2507.22049](https://arxiv.org/abs/2507.22049) | Preprint | Two-stage validation: replicate known results, then make new predictions. |

**Foundation models of human behaviour**

| Citation | Status | Key finding |
|---|---|---|
| Binz, M., Akata, E., Bethge, M., Brändle, F., Callaway, F., Coda-Forno, J., et al. (2025). "A foundation model to predict and capture human cognition." *Nature* 644: 1002–1009. [doi:10.1038/s41586-025-09215-4](https://doi.org/10.1038/s41586-025-09215-4) | Peer-reviewed | "Centaur": an LLM fine-tuned on 160 psychology experiments. The "train a behaviour model" alternative to Park's "prompt with self-reports". |
| Xie, Y., Li, Z., Wang, X., Pan, Y., Liu, Q., Cui, X., et al. (2025). "Be.FM: Open Foundation Models for Human Behavior." [arXiv:2505.23058](https://arxiv.org/abs/2505.23058) | Preprint | An open behaviour model. |
| Aher, G., Arriaga, R.I. & Kalai, A.T. (2023). "Using Large Language Models to Simulate Multiple Humans and Replicate Human Subject Studies." *ICML 2023*. [arXiv:2208.10264](https://arxiv.org/abs/2208.10264) | Peer-reviewed; not cited by Park | Found "hyper-accuracy distortion" in larger models. |

**Critiques and validation frameworks**

| Citation | Status | Key finding |
|---|---|---|
| Bisbee, J., Clinton, J.D., Dorff, C., Kenkel, B. & Larson, J.M. (2024). "Synthetic Replacements for Human Survey Data? The Perils of Large Language Models." *Political Analysis* 32: 401–416. [doi:10.1017/pan.2024.5](https://doi.org/10.1017/pan.2024.5) | Peer-reviewed; not cited by Park | ChatGPT survey answers have too little variety and shift with prompt wording and over time. **[POLICY]** |
| Kozlowski, A.C. & Evans, J. (2025). "Simulating Subjects: The Promise and Peril of Artificial Intelligence Stand-Ins for Social Agents and Interactions." *Sociological Methods & Research* 54(3): 1017–1073. [doi:10.1177/00491241251337316](https://doi.org/10.1177/00491241251337316) | Peer-reviewed | Comprehensive review of where AI stand-ins fail. |
| Gao, Y., Lee, D., Burtch, G. & Fazelpour, S. (2025). "Take caution in using LLMs as human surrogates." *PNAS* 122. [doi:10.1073/pnas.2501660122](https://doi.org/10.1073/pnas.2501660122) | Peer-reviewed | LLMs fail to reproduce the spread of human reasoning in a strategy game. |
| Dillion, D., Tandon, N., Gu, Y. & Gray, K. (2023). "Can AI language models replace human participants?" *Trends in Cognitive Sciences* 27: 597–600. [doi:10.1016/j.tics.2023.04.008](https://doi.org/10.1016/j.tics.2023.04.008) | Peer-reviewed; not cited by Park | Influential short piece on when replacing participants is appropriate. |
| Wang, Q., Wu, J., Jiang, Z., Tang, Z., Luo, B., Chen, N., et al. (2025). "LLM-based Human Simulations Have Not Yet Been Reliable." [arXiv:2501.08579](https://arxiv.org/abs/2501.08579) | Preprint (position paper) | Reviews gaps between simulated and real outcomes. |
| Madden, E.R. (2025). "Evaluating the Use of Large Language Models as Synthetic Social Agents in Social Science Research." [arXiv:2509.26080](https://arxiv.org/abs/2509.26080) | Preprint | Cautions on interpretation. |
| Jang, C., Min, J., Choi, J., Lee, D., Lee, H., Park, J., et al. (2026). "From Simulated Citizens to Simulated Deliberation: Challenges in Representation and Interaction." [arXiv:2609.07573](https://arxiv.org/abs/2609.07573) | Preprint | Census-based Korean agents debating real policy did not reproduce national opinion and sometimes reversed group differences. **[POLICY]** |
| Grossmann, I., Feinberg, M., Parker, D.C., Christakis, N.A., Tetlock, P.E. & Cunningham, W.A. (2023). "AI and the transformation of social science research." *Science* 380: 1108–1109. [doi:10.1126/science.adi1778](https://doi.org/10.1126/science.adi1778) | Peer-reviewed | Early agenda piece. |
| Bail, C.A. (2024). "Can Generative AI improve social science?" *PNAS* 121. [doi:10.1073/pnas.2314021121](https://doi.org/10.1073/pnas.2314021121) | Peer-reviewed | Overview of opportunities and risks. |

**Large simulated societies and economies**

| Citation | Status | Key finding |
|---|---|---|
| Piao, J., Yan, Y., Zhang, J., Li, N., Yan, J., Lan, X., et al. (2025). "AgentSociety: Large-Scale Simulation of LLM-Driven Generative Agents Advances Understanding of Human Behaviors and Society." [arXiv:2502.08691](https://arxiv.org/abs/2502.08691) | Preprint | More than 10,000 agents; studies polarisation, universal basic income and hurricane response. **[POLICY]** |
| Zhang, X., Lin, J., Mou, X., Yang, S., Liu, X., Sun, L., et al. (2025). "SocioVerse: A World Model for Social Simulation Powered by LLM Agents and A Pool of 10 Million Real-World Users." [arXiv:2504.10157](https://arxiv.org/abs/2504.10157) | Preprint | Agents drawn from real social-media users; election and economic-survey cases. **[POLICY]** |
| Vezhnevets, A.S., Agapiou, J.P., Aharon, A., Ziv, R., Matyas, J., Duéñez-Guzmán, E.A., et al. (2023). "Generative agent-based modeling with actions grounded in physical, social, or digital space using Concordia." [arXiv:2312.03664](https://arxiv.org/abs/2312.03664) | Preprint | Google DeepMind's open simulation library. |
| Li, N., Gao, C., Li, M., Li, Y. & Liao, Q. (2023/2024). "EconAgent: Large Language Model-Empowered Agents for Simulating Macroeconomic Activities." [arXiv:2310.10436](https://arxiv.org/abs/2310.10436) | Reported as ACL 2024 (venue not re-verified) | LLM households respond to tax and interest-rate policy. **[POLICY]** |
| Karten, S., Li, W., Ding, Z., Kleiner, S., Bai, Y. & Jin, C. (2025). "LLM Economist: Large Population Models and Mechanism Design in Multi-Agent Generative Simulacra." [arXiv:2507.15815](https://arxiv.org/abs/2507.15815) | Preprint | A planner agent designs taxes for census-calibrated workers. **[POLICY]** |
| Hao, Y. & Xie, D. (2025). "A Multi-LLM-Agent-Based Framework for Economic and Public Policy Analysis." [arXiv:2502.16879](https://arxiv.org/abs/2502.16879) | Preprint | Different LLMs act as different households; simulates a tax change. **[POLICY]** |

## 6. Simulated policymakers: FOMC agents lead, but none has beaten the market

**Simulating named policymakers works best for rule-bound committees making routine decisions.** It works worst for surprises, for crises, and wherever the base model's own political leanings creep in. Policymaker simulators cannot use Park's method directly, because officials will not sit for two-hour interviews. Instead they build each persona from the **public record**: speeches, votes, tweets and biographies. That is Park's grounding lesson applied with different data. As of October 2026, no study has a live, pre-registered forecast record, and none has shown it beats market prices.

### Central bankers: a strong backtest with an untested benchmark

The leading study is **"FOMC In Silico"** by Kazinnik and Sinclair, a working paper whose latest version is dated 16 July 2026 ([NBER conference paper](https://conference.nber.org/conf_papers/f244384.pdf)). Each LLM agent represents one FOMC member. Personas are built from biographies, past policy leanings and recent speeches, which an LLM labels as hawkish, dovish or data-dependent. Agents receive real-time economic data, debate in plain language, and then vote. The simulation uses GPT-4o.

The backtest results are strong. Over **218 meetings from 2000 to June 2026**, the average miss was **8.3 basis points**, the simulated rate was within 0.25 points of the real one in over 94% of meetings, and hike/hold/cut was right about 91% of the time. A random-walk guess scored 37 bp, and a simple Taylor rule 35 bp with 66% directional accuracy.

The authors take memorization seriously, but the test is thin. Asked directly, GPT-4o recalls the actual decision for **97.2% of meetings**. The simulation's error was similar before and after the model's October 2023 training cutoff (8.2 bp vs 9.2 bp), but the post-cutoff test covers only **22 meetings**. Most importantly for investors, the paper names a random walk, Taylor rules and a voting model as benchmarks, **not fed funds futures or market-implied odds**. The question that matters commercially, whether it adds anything to market pricing, is unanswered.

Its most useful results may be the "what if" experiments. In a stagflation scenario, swapping 4 of 12 members for historical hawks moved the year-end rate by **168 basis points**, far more than changing the chair or the Fed's mandate. A president's rate demand made in private had no effect; made in public, it shifted members' views by about a tenth of the amount demanded. Deliberation did not improve accuracy over simply averaging members' views, but removing it raised dissent by about 40%. The work was presented at a Bank of England Monetary Policy Committee meeting and an ECB forecasting conference.

Other FOMC simulators are weaker evidence. MiniFed is a five-stage meeting simulation ([arXiv:2410.18012](https://arxiv.org/abs/2410.18012)). FedSight AI reports 93.75% accuracy on 2023–2024 meetings, which most likely means 15 of 16, a tiny sample of well-signalled decisions ([arXiv:2512.15728](https://arxiv.org/abs/2512.15728)). Takano and colleagues give agents hidden hawkish or dovish beliefs and have them debate; debate beat single-LLM baselines ([LNCS](https://doi.org/10.1007/978-3-032-13562-9_38)). Collodel simulated 30 traders reading ECB press conferences; their disagreement correlated about 0.5 with real market volatility ([arXiv:2508.13635](https://arxiv.org/abs/2508.13635)). No LLM simulation of the ECB, Bank of England or Bank of Japan committees as decision-makers was found.

### Legislators: good on party lines, untested on rebels

**Persona agents predict individual legislators' votes moderately well, but party line already predicts most votes.** In the European Parliament, zero-shot personas predicted individual votes with a weighted F1 score (a balanced accuracy measure) of **about 0.79**, but showed a "progressive left-leaning bias" ([Kreutner, Lutz & Strohmaier](https://doi.org/10.18653/v1/2026.findings-eacl.25)). Political Actor Agent, built from Wikipedia pages, bill texts and voting records, claims gains over older methods for the US House ([AAAI 2025](https://doi.org/10.1609/aaai.v39i1.32017)). A "digital twin of Congress" generated tweets hard to tell from real ones and used them to predict votes and defections ([arXiv:2505.00006](https://arxiv.org/abs/2505.00006)).

Off-the-shelf chat models struggle to stay partisan. A 2026 study argues that training for neutrality and helpfulness "prevent[s] them from sustaining steadfast partisan behaviour", and fixes this with fine-tuning plus retrieval over each party's manifesto ([Digital Pantheon](https://arxiv.org/abs/2607.15095)). A 2026 benchmark found that **fine-tuning on the grounded record beat multi-agent simulation** for predicting who a policy affects ([GPS-Bench](https://arxiv.org/abs/2609.03553)). The valuable cases, such as defections, swing members and whether a bill reaches the floor, remain largely untested.

### Judges: ideology priors inflate accuracy

**Frontier LLMs forecasting the Supreme Court lean on ideology rather than legal reasoning.** A 2026 study had GPT-5, Gemini 2.5 Pro, Claude Sonnet 4.5 and Grok 4 predict every argued case of the October 2025 term. Conventional accuracy metrics overstated their skill, and the models **overpredicted ideologically split decisions**, especially in cases the Court resolved on narrow technical grounds ([Stillwell & Harrington, via beSpacific](https://www.bespacific.com/?p=126584)). Only the abstract was available. The older machine-learning benchmark of about 70% ([Katz et al.](https://doi.org/10.1371/journal.pone.0174698)) remains the bar to beat.

### Heads of state and crises: scenario tools, not forecasters

**LLM "leaders" behave differently from human experts, and the model chosen drives much of the result.** Meta's CICERO played the negotiation game Diplomacy at human level ([Science 2022](https://doi.org/10.1126/science.ade9097)). But all five off-the-shelf LLMs tested in military and diplomatic scenarios showed escalation, including rare nuclear use ([Rivera et al.](https://doi.org/10.1145/3630106.3658942)). Compared with 214 national-security experts in a US–China crisis game, LLM teams agreed at a high level but differed on specific actions and could be more aggressive ([Lamparth et al.](https://doi.org/10.1609/aies.v7i1.31681)). A benchmark of 400 expert-written scenarios found models recommend less escalation toward China and Russia ([CFPD-Benchmark](https://arxiv.org/abs/2503.06263)). No study has validated an AI twin of a named living leader against that leader's later decisions.

### Voters, the public and stakeholders: useful for exploring, unreliable for replacing polls

**Synthetic publics reproduce broad averages but miss variety, subgroups and real elections.** The AI polling startup Aaru came within 371 votes in a June 2024 New York primary, then predicted a narrow Harris win in the 2024 presidential election ([Semafor](https://semafor.com/article/11/04/2024/an-ai-polling-startup-polls-bots-predicts-harris-will-win)). Census-based agents debating real Korean policy questions did not reproduce national opinion ([Jang et al.](https://arxiv.org/abs/2609.07573)). Simulating public comments on proposed regulations, to predict what final rules will say, appears unstudied.

### General AI forecasters now match superforecasters, but not liquid markets

**AI forecasting has gone from clearly worse than human crowds in 2023–24 to roughly superforecaster level by mid-2026.** It still has not beaten liquid prediction markets on their own questions.

A retrieval-based system tested on questions after its training cutoff "nears the crowd aggregate of competitive forecasters" ([Halawi et al.](https://arxiv.org/abs/2402.18563)). An ensemble of 12 LLMs matched a 925-person human crowd on 31 questions, but tended to guess above 50% ([Schoenegger et al.](https://doi.org/10.1126/sciadv.adp1528)). LLM assistants improved human forecasters' accuracy by **24–28%** ([arXiv:2402.07862](https://arxiv.org/abs/2402.07862)).

On the ForecastBench benchmark, the gap to superforecasters shrank to 0.017 Brier points by January 2026, with parity projected around late 2026 ([Forecasting Research Institute](https://forecastingresearch.substack.com/p/llms-are-closing-the-gap-on-human)). Bridgewater's AI lab reported a forecaster **equal to superforecasters on ForecastBench but worse than market consensus** on liquid prediction markets; combining the AI with the market beat the market alone ([AIA Forecaster](https://arxiv.org/abs/2511.07678)). In live Metaculus tournaments, professional forecasters kept a clear lead in 2025 ([Metaculus Q2 2025](https://www.lesswrong.com/posts/Surnjh8A4WjgtQTkZ/q2-ai-benchmark-results-pros-maintain-clear-lead)), though by a later round the gap was no longer statistically significant ([FutureEval Spring](https://www.lesswrong.com/posts/wZBbDqzfBjYG58CxK/futureeval-spring-results-pros-beat-bots-but-the-gap-is)). Then in the Summer 2026 Metaculus Cup, the startup Mantic's AI beat every human contestant ([Reuters via The Star](https://www.thestar.com.my/tech/tech-news/2026/09/18/ai-startup-mantic-raises-25-million-for-superhuman-forecasting)). These are different claims: "matches superforecasters on a benchmark" and "beat all humans in one tournament" are not the same as "consistently beats the best humans" or "beats markets".

### What funds actually do with LLMs today

**Verified fund use is about reading text and speeding up research, not running digital twins of officials.** JPMorgan scores Fed speeches; Balyasny cut meeting previews to 30 minutes; Bridgewater published its forecaster; Man Group's AlphaGPT uses agents to propose and test trading signals, but cannot run unsupervised ([Man Group](https://www.man.com/insights/what-ai-can-do-for-alpha)). Citadel's Ken Griffin said in October 2025 that generative AI "enhances productivity, but for uncovering alpha it just falls short" ([Hedgeweek](https://www.hedgeweek.com/generative-ai-fails-to-deliver-alpha-for-hedge-funds-says-griffin/)). No verified source shows a fund trading on simulated policymakers.

### Backtests flatter models that remember history

**The biggest technical risk is memorization: LLMs have read about past decisions, so tests on the past look better than real forecasting.** LLMs "cannot be trusted for economic forecasts during periods covered by their training data"; they recall exact past values, and instructions to ignore later dates fail ([Lopez-Lira, Tang & Zhu](https://arxiv.org/abs/2504.14765)). Evaluations of AI forecasters suffer many forms of this time leakage ([Paleka et al.](https://arxiv.org/abs/2506.00723)). One proposed fix is models trained only on text up to each date ([He, Lv, Manela & Wu](https://arxiv.org/abs/2502.21206)).

### Reading list for Section 6

**Central bankers**

| Citation | Status | Key finding |
|---|---|---|
| Kazinnik, S. & Sinclair, T.M. (2025/2026). "FOMC In Silico: A Multi-Agent System for Monetary Policy Decision Modeling." GWU Center for Economic Research WP 2025-005. [NBER conference version](https://conference.nber.org/conf_papers/f244384.pdf); [Oct 2025 draft](https://www.ecb.europa.eu/press/conferences/shared/pdf/20260323_forecasting/Kazinnik_paper.pdf); [RePEc](https://econpapers.repec.org/paper/gwcwpaper/2025-005.htm) | Working paper; versions differ | 218-meeting backtest, 8.3 bp miss, about 91% direction; no market benchmark. |
| Seok, S., Wen, S., Yang, Q., Feng, J. & Yang, W. (2024). "MiniFed: Integrating LLM-based Agentic-Workflow for Simulating FOMC Meeting." [arXiv:2410.18012](https://arxiv.org/abs/2410.18012) | Preprint | Five-stage meeting simulation. |
| Hou, Y., Rao, T., Tan, J., Viton, A., Zhang, X., Ye, D., et al. (2025). "FedSight AI: Multi-Agent System Architecture for Federal Funds Target Rate Prediction." NeurIPS 2025 GenAI in Finance workshop. [arXiv:2512.15728](https://arxiv.org/abs/2512.15728) | Workshop paper | 93.75% on a small 2023–2024 sample. |
| Takano, K., Hirano, M. & Nakagawa, K. (2026). "Modeling Hawkish-Dovish Latent Beliefs in Multi-agent Debate-Based LLMs for Monetary Policy Decision Classification." *Lecture Notes in Computer Science*: 488–505. [doi:10.1007/978-3-032-13562-9_38](https://doi.org/10.1007/978-3-032-13562-9_38); [arXiv:2511.02469](https://arxiv.org/abs/2511.02469) | Peer-reviewed (proceedings) | Debating agents with hidden beliefs beat single LLMs. |
| Collodel, U. (2025). "Interpreting the Interpreter: Can We Model post-ECB Conferences Volatility with LLM Agents?" [arXiv:2508.13635](https://arxiv.org/abs/2508.13635) | Preprint | Simulated traders' disagreement tracks real volatility. |
| Hansen, Horton, Kazinnik, Puzzello & Zarifhonarvar "Simulating the Survey of Professional Forecasters." SSRN. [doi:10.2139/ssrn.5066286](https://doi.org/10.2139/ssrn.5066286) | Working paper | LLM personas as synthetic economic forecasters. |

**Legislators (with pre-LLM baselines)**

| Citation | Status | Key finding |
|---|---|---|
| Li, H., Gong, R. & Jiang, H. (2025). "Political Actor Agent: Simulating Legislative System for Roll Call Votes Prediction with Large Language Models." *AAAI 2025*. [doi:10.1609/aaai.v39i1.32017](https://doi.org/10.1609/aaai.v39i1.32017); [arXiv:2412.07144](https://arxiv.org/abs/2412.07144) | Peer-reviewed | Role-playing agents predict US House votes. |
| Kreutner, M., Lutz, M. & Strohmaier, M. (2026). "Persona-driven Simulation of Voting Behavior in the European Parliament with Large Language Models." *Findings of EACL 2026*. [doi:10.18653/v1/2026.findings-eacl.25](https://doi.org/10.18653/v1/2026.findings-eacl.25) | Peer-reviewed | Weighted F1 about 0.79; left-leaning bias; data released. |
| Helm, H., Chen, T., McGuinness, H., Lee, P., Duderstadt, B. & Priebe, C.E. (2025). "Toward a digital twin of U.S. Congress." [arXiv:2505.00006](https://arxiv.org/abs/2505.00006) † | Preprint | Tweet-trained models predict votes and defections. |
| Baker, Z.R. & Azher, Z.L. (2024). "Simulating The U.S. Senate: An LLM-Driven Agent Approach to Modeling Legislative Behavior and Bipartisanship." [arXiv:2406.18702](https://arxiv.org/abs/2406.18702) | Preprint | Qualitative committee debate simulation. |
| Wu, Nagler, Tucker & Messing (2023). "Large Language Models Can Be Used to Estimate the Latent Positions of Politicians." [arXiv:2303.12057](https://arxiv.org/abs/2303.12057) | Preprint | LLM pairwise comparisons recover ideology scales. |
| O'Hagan & Schein (2023). "Measurement in the Age of LLMs: An Application to Ideological Scaling." [arXiv:2312.09203](https://arxiv.org/abs/2312.09203) | Preprint | LLM ideology scores match established methods. |
| Van Mulders, Bogaert & Van den Poel (2026). "Digital Pantheon: Simulating and Auditing Coalition Formation with LLM Agents." ECML PKDD 2026 AIDEM workshop. [arXiv:2607.15095](https://arxiv.org/abs/2607.15095) | Workshop paper | Fine-tuning plus manifesto retrieval keeps agents partisan. |
| Koniaris, Tsipi & Tsanakas (2026). "ParliaBench: An Evaluation and Benchmarking Framework for LLM-Generated Parliamentary Speech." *LREC 2026*. [arXiv:2511.08247](https://arxiv.org/abs/2511.08247) | Peer-reviewed | Benchmark for politician-style speech. |
| Le, L., Bui, M., Nguyen, M.C., Schlosser, Z. & Williams-King, D. (2026). "GPS-Bench: A Governance Policy Benchmark for Automating Policy Analysis." [arXiv:2609.03553](https://arxiv.org/abs/2609.03553) | Preprint | Fine-tuning on records beats multi-agent simulation. |
| Li et al. (2024). "Political-LLM: Large Language Models in Political Science." [arXiv:2412.06864](https://arxiv.org/abs/2412.06864) | Preprint (survey) | Overview of LLM uses in political science. |
| Clinton, Jackman & Rivers (2004). "The Statistical Analysis of Roll Call Data." *APSR* 98(2): 355–370. [doi:10.1017/S0003055404001194](https://doi.org/10.1017/S0003055404001194) | Peer-reviewed | The standard Bayesian ideal-point baseline. |
| Gerrish & Blei (2011). "Predicting Legislative Roll Calls from Text." *ICML 2011*. [PDF](https://icml.cc/imls/conferences/2011/papers/333_icmlpaper.pdf) | Peer-reviewed | Predicts votes on new bills from their text. |
| Gerrish & Blei (2012). "How They Vote: Issue-Adjusted Models of Legislative Behavior." *NIPS 2012*. [PDF](https://www.cs.columbia.edu/~blei/papers/GerrishBlei2012.pdf) | Peer-reviewed | Issue-specific ideal points. |
| Kraft, Jain & Rush (2016). "An Embedding Model for Predicting Roll-Call Votes." *EMNLP 2016*. [doi:10.18653/v1/D16-1221](https://doi.org/10.18653/v1/D16-1221) | Peer-reviewed | Embedding baseline. |
| Kornilova, Argyle & Eidelman (2018). "Party Matters: Enhancing Legislative Embeddings with Author Attributes for Vote Prediction." *ACL 2018*. [doi:10.18653/v1/P18-2081](https://doi.org/10.18653/v1/P18-2081) | Peer-reviewed | Adds sponsor attributes. |
| Vafa, Naidu & Blei (2020). "Text-Based Ideal Points." *ACL 2020*. [doi:10.18653/v1/2020.acl-main.475](https://doi.org/10.18653/v1/2020.acl-main.475) | Peer-reviewed | Political positions from text alone. |

**Judges**

| Citation | Status | Key finding |
|---|---|---|
| Martin & Quinn (2002). "Dynamic Ideal Point Estimation via MCMC for the U.S. Supreme Court, 1953–1999." *Political Analysis* 10(2). [doi:10.1093/pan/10.2.134](https://doi.org/10.1093/pan/10.2.134) | Peer-reviewed | "Martin–Quinn" ideology scores for justices. |
| Aletras, Tsarapatsanis, Preoţiuc-Pietro & Lampos (2016). "Predicting judicial decisions of the European Court of Human Rights: an NLP perspective." *PeerJ Computer Science* 2: e93. [doi:10.7717/peerj-cs.93](https://doi.org/10.7717/peerj-cs.93) | Peer-reviewed | Predicts European human-rights rulings from text. |
| Medvedeva, Vols & Wieling (2020). "Using machine learning to predict decisions of the European Court of Human Rights." *Artificial Intelligence and Law* 28(2): 237–266. [doi:10.1007/s10506-019-09255-y](https://doi.org/10.1007/s10506-019-09255-y) | Peer-reviewed | Follow-up on the same court. |
| Chalkidis, Androutsopoulos & Aletras (2019). "Neural Legal Judgment Prediction in English." *ACL 2019*. [arXiv:1906.02059](https://arxiv.org/abs/1906.02059) | Peer-reviewed | Neural model for the same task. |
| Hamilton (2023). "Blind Judgement: Agent-Based Supreme Court Modelling With GPT." AAAI-23 workshop. [arXiv:2301.05327](https://arxiv.org/abs/2301.05327) | Workshop paper | One model per justice; better than random on 96 cases. |
| Stillwell & Harrington (2026). "Predicting the Court: Evaluating Large Language Models as Forecasters of Supreme Court Decisions." SSRN, 10 July 2026. [Abstract via beSpacific](https://www.bespacific.com/?p=126584) | Working paper; full text not accessed | Accuracy overstated by ideology; overpredicts split decisions. |
| Aldahoul, Ibrahim, Kaufman, Rahwan & Zaki (2025). "The Political Ideology of Large Language Models…" [arXiv:2505.04171](https://arxiv.org/abs/2505.04171) | Preprint | LLMs voting as justices on 1,749 cases, to measure LLM ideology. |

**Heads of state, negotiators and crises**

| Citation | Status | Key finding |
|---|---|---|
| Bakhtin, Brown, Dinan, et al. (Meta FAIR Diplomacy Team) (2022). "Human-level play in the game of Diplomacy by combining language models with strategic reasoning." *Science* 378(6624): 1067–1074. [doi:10.1126/science.ade9097](https://doi.org/10.1126/science.ade9097) | Peer-reviewed | Human-level negotiating AI. |
| Rivera, Mukobi, Reuel, Lamparth, Smith & Schneider (2024). "Escalation Risks from Language Models in Military and Diplomatic Decision-Making." *ACM FAccT 2024*. [doi:10.1145/3630106.3658942](https://doi.org/10.1145/3630106.3658942) | Peer-reviewed | All five LLMs escalated. |
| Lamparth, Corso, Ganz, Mastro, Schneider & Trinkunas (2024). "Human vs. Machine: Behavioral Differences Between Expert Humans and Language Models in Wargame Simulations." *AIES 2024*. [doi:10.1609/aies.v7i1.31681](https://doi.org/10.1609/aies.v7i1.31681) | Peer-reviewed | LLM teams vs 214 experts: agree broadly, differ in actions. |
| Jensen, Reynolds, Atalan, Garcia, Woo, et al. (2025). "Critical Foreign Policy Decisions (CFPD)-Benchmark." [arXiv:2503.06263](https://arxiv.org/abs/2503.06263) | Preprint | Country-specific escalation biases. |
| Solopova et al. (2026). "LLMs as Strategic Actors: Behavioral Alignment, Risk Calibration, and Argumentation Framing in Geopolitical Simulations." [arXiv:2603.02128](https://arxiv.org/abs/2603.02128) | Preprint | Models track humans early, then diverge. |
| Hua et al. (2023). "War and Peace (WarAgent): LLM-based Multi-Agent Simulation of World Wars." [arXiv:2311.17227](https://arxiv.org/abs/2311.17227) | Preprint | Agents replay historical wars. |
| Mukobi et al. (2023). "Welfare Diplomacy: Benchmarking Language Model Cooperation." [arXiv:2310.08901](https://arxiv.org/abs/2310.08901) | Preprint | Cooperation benchmark. |
| Hogan & Brennen (2024). "Open-Ended Wargames with Large Language Models." [arXiv:2404.11446](https://arxiv.org/abs/2404.11446) | Preprint | "Snow Globe" wargame tool. |
| Aoki, G. & Ghaffarzadegan, N. (2026). "AI Agents as Policymakers in Simulated Epidemics." [arXiv:2601.04245](https://arxiv.org/abs/2601.04245) | Preprint | An LLM "mayor" makes repeated epidemic decisions. |

**Voters, the public and stakeholders** (Argyle et al., Bisbee et al., Santurkar et al., Wang et al. and Ashokkumar et al. are listed in Sections 4–5.)

| Citation | Status | Key finding |
|---|---|---|
| Yu, C., Ye, J., Li, Y., Li, Z., Ferrara, E., Hu, X., et al. (2024). "A Large-Scale Simulation on Large Language Models for Decision-Making in Political Science." [arXiv:2412.15291](https://arxiv.org/abs/2412.15291) | Preprint | Voter personas calibrated to real data simulate US elections. |
| Zhang, X., Lin, J., Sun, L., Qi, W., Yang, Y., Chen, Y., et al. (2024). "ElectionSim: Massive Population Election Simulation Powered by Large Language Model Driven Agents." [arXiv:2410.20746](https://arxiv.org/abs/2410.20746) | Preprint | Million-scale voter pool from social media. |
| Parikh, R., Cen, S.H. & Podimata, C. (2026). "Do LLMs Track Public Opinion? A Multi-Model Study of Favorability Predictions in the 2024 U.S. Presidential Election." [arXiv:2602.06302](https://arxiv.org/abs/2602.06302) † | Preprint | Tests LLM opinion tracking in 2024. |
| Gong, E., Sanders, N.E. & Schneier, B. (2026). "Characterizing the ability of LLMs to recapitulate Americans' distributional responses to public opinion polling questions across political issues." [arXiv:2603.20229](https://arxiv.org/abs/2603.20229) † | Preprint | Tests opinion distributions by issue. |
| Kim, J. & Lee, B. (2023). "AI-Augmented Surveys: Leveraging Large Language Models and Surveys for Opinion Prediction." [arXiv:2305.09620](https://arxiv.org/abs/2305.09620) | Preprint | LLMs fine-tuned on GSS fill in missing opinion trends. |
| Sun, S., Lee, E., Nan, D., Zhao, X., Lee, W., Jansen, B.J., et al. (2024). "Random Silicon Sampling." [arXiv:2402.18144](https://arxiv.org/abs/2402.18144) | Preprint | Group-level demographic sampling. |
| Jiang, Wei & Zhang (2024). "Donald Trumps in the Virtual Polls." [arXiv:2411.01582](https://arxiv.org/abs/2411.01582) | Preprint | LLM polling of the 2024 race. |
| Fulay, S., Dimitrakopoulou, D. & Roy, D. (2025). "The Empty Chair: Using LLMs to Raise Missing Perspectives in Policy Deliberations." [arXiv:2503.13812](https://arxiv.org/abs/2503.13812) | Preprint | Personas stand in for absent stakeholders. |
| Fulay, S., Zhu, J. & Bakker, M. (2025). "From Delegates to Trustees: How Optimizing for Long-Term Interests Shapes Bias and Alignment in LLM." [arXiv:2510.12689](https://arxiv.org/abs/2510.12689) | Preprint | Simulated policy votes, two framings. |
| Tessler, M.H., Bakker, M.A., Jarrett, D., Sheahan, H., Chadwick, M.J., Koster, R., et al. (2024). "AI can help humans find common ground in democratic deliberation." *Science* 386. [doi:10.1126/science.adq2852](https://doi.org/10.1126/science.adq2852) | Peer-reviewed | The "Habermas Machine"; aggregates views rather than simulating people. |
| Hou, A.B., Du, H., Wang, Y., Zhang, J., Wang, Z., Liang, P.P., et al. (2025). "Can A Society of Generative Agents Simulate Human Behavior and Inform Public Health Policy? A Case Study on Vaccine Hesitancy." [arXiv:2503.09639](https://arxiv.org/abs/2503.09639) † | Preprint | Agent society for vaccine policy. |
| Koaik, F., Gupta, A. & Sheikh, F.R. (2026). "LLM Powered Social Digital Twins: A Framework for Simulating Population Behavioral Response to Policy Interventions." [arXiv:2601.06111](https://arxiv.org/abs/2601.06111) | Preprint | Calibration layer; 20.7% error reduction vs a standard model in a COVID case. |
| Yan, X., Dai, T. & Nie, Y.M. (2025). "Addressing the alignment problem in transportation policy making: an LLM approach." [arXiv:2510.13139](https://arxiv.org/abs/2510.13139) † | Preprint | Resident agents vote on transit policy. |
| Bachmann, F., van der Weijden, D., Heitz, L., Sarasua, C. & Bernstein, A. (2025). "Adaptive political surveys and GPT-4: Tackling the cold start problem with simulated user interactions." *PLOS One* 20: e0322690. [doi:10.1371/journal.pone.0322690](https://doi.org/10.1371/journal.pone.0322690) † | Peer-reviewed | Simulated users bootstrap political surveys. |

**AI forecasting and its pitfalls**

| Citation | Status | Key finding |
|---|---|---|
| Zou et al. (2022). "Forecasting Future World Events with Neural Networks" (Autocast). *NeurIPS 2022*. [arXiv:2206.15474](https://arxiv.org/abs/2206.15474) | Peer-reviewed | Early world-events dataset. |
| Halawi, Zhang, Yueh-Han & Steinhardt (2024). "Approaching Human-Level Forecasting with Language Models." *NeurIPS 2024*. [doi:10.52202/079017-1598](https://doi.org/10.52202/079017-1598) | Peer-reviewed | Nears the human crowd on post-cutoff questions. |
| Schoenegger, Tuminauskaite, Park, Bastos & Tetlock (2024). "Wisdom of the silicon crowd: LLM ensemble prediction capabilities rival human crowd accuracy." *Science Advances* 10(45): eadp1528. [doi:10.1126/sciadv.adp1528](https://doi.org/10.1126/sciadv.adp1528) | Peer-reviewed | 12 LLMs match 925 humans; bias toward "yes". |
| Schoenegger, Park, Karger, Trott & Tetlock (2024). "AI-Augmented Predictions: LLM Assistants Improve Human Forecasting Accuracy." [arXiv:2402.07862](https://arxiv.org/abs/2402.07862) | Preprint | 24–28% accuracy gain for humans. |
| Pratt, Blumberg, Carolino & Morris (2024). "Can Language Models Use Forecasting Strategies?" [arXiv:2406.04446](https://arxiv.org/abs/2406.04446) | Preprint | Models struggle; guess "unlikely" too often. |
| Karger, Bastani, Yueh-Han, Jacobs, Halawi, Zhang, et al. (2024). "ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities." [arXiv:2409.19839](https://arxiv.org/abs/2409.19839) | Preprint (reported as ICLR 2025; not verified) | Leakage-resistant benchmark. |
| Alur, Stadie, Kang, … Sekhon (Bridgewater AIA Labs) (2025). "AIA Forecaster: Technical Report." [arXiv:2511.07678](https://arxiv.org/abs/2511.07678) | Preprint (industry) | Matches superforecasters; trails markets; AI plus market beats market. |
| Turtel, Franklin, Skotheim, Hewitt & Schoenegger (2025). "Outcome-based Reinforcement Learning to Predict the Future." [arXiv:2505.17989](https://arxiv.org/abs/2505.17989) | Preprint | A small trained model matches larger ones with better calibration. |
| Ye et al. (2024). "MIRAI: Evaluating LLM Agents for Event Forecasting." [arXiv:2407.01231](https://arxiv.org/abs/2407.01231) | Preprint | International-relations event forecasting. |
| Zeng et al. (2025). "FutureX: An Advanced Live Benchmark for LLM Agents in Future Prediction." [arXiv:2508.11987](https://arxiv.org/abs/2508.11987) | Preprint | Live, contamination-free benchmark. |
| FutureSearch (Wildman, Bosse, et al.) (2025). "Bench to the Future: A Pastcasting Benchmark for Forecasting Agents." [arXiv:2506.21558](https://arxiv.org/abs/2506.21558) | Preprint | Frozen-web "pastcasting" benchmark. |
| Paleka et al. (2024). "Consistency Checks for Language Model Forecasters." [arXiv:2412.18544](https://arxiv.org/abs/2412.18544) | Preprint | Checks forecasts for logical consistency. |
| Lopez-Lira, Tang & Zhu (2025). "The Memorization Problem: Can We Trust LLMs' Economic Forecasts?" [arXiv:2504.14765](https://arxiv.org/abs/2504.14765) | Preprint | LLMs recall the past; backtests mislead. |
| Paleka, Goel, Geiping & Tramèr (2025). "Pitfalls in Evaluating Language Model Forecasters." [arXiv:2506.00723](https://arxiv.org/abs/2506.00723) | Preprint | Many forms of time leakage. |
| He, Lv, Manela & Wu (2025). "Chronologically Consistent Large Language Models." [arXiv:2502.21206](https://arxiv.org/abs/2502.21206) | Preprint | Date-restricted models as a fix. |
| Drinkall, Rahimikia, Pierrehumbert & Zohren (2024). "Time Machine GPT." *Findings of NAACL 2024*. [arXiv:2404.18543](https://arxiv.org/abs/2404.18543) | Peer-reviewed | Point-in-time models. |
| Glasserman & Lin (2023). "Assessing Look-Ahead Bias in Stock Return Predictions Generated by GPT Sentiment Analysis." [arXiv:2309.17322](https://arxiv.org/abs/2309.17322) | Preprint | Look-ahead bias in GPT stock signals. |
| Sarkar & Vafa (2024). "Lookahead Bias in Pretrained Language Models." SSRN. [doi:10.2139/ssrn.4754678](https://doi.org/10.2139/ssrn.4754678) | Working paper | Same problem, general form. |
| Sharma et al. (2023). "Towards Understanding Sycophancy in Language Models." [arXiv:2310.13548](https://arxiv.org/abs/2310.13548) | Preprint | LLMs tend to tell users what they want to hear. |
| Wu et al. (Bloomberg) (2023). "BloombergGPT: A Large Language Model for Finance." [arXiv:2303.17564](https://arxiv.org/abs/2303.17564) | Preprint (industry) | A finance-specific LLM. |

## 7. Start here: eight papers, in reading order

**Read these eight first.** They build from "what good forecasting looks like" to "how AI simulates people" to "how it simulates policymakers" to "why to be careful".

| Order | Paper | Why read it now |
|---|---|---|
| 1 | Diercks, Katz & Wright (2026). "Kalshi and the Rise of Macro Markets." FEDS 2026-010. [Fed page](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm) | Shows the benchmark any policy forecast must beat: a market that was perfect one day before Fed decisions. Short and readable. Working paper. |
| 2 | Argyle, L.P., Busby, E.C., Fulda, N., Gubler, J.R., Rytting, C. & Wingate, D. (2023). "Out of One, Many: Using Language Models to Simulate Human Samples." *Political Analysis* 31: 337–351. [doi:10.1017/pan.2023.2](https://doi.org/10.1017/pan.2023.2) | The founding idea: an LLM given a demographic backstory can stand in for a group of voters. Everything later reacts to it. |
| 3 | Park, Zou, Kamphorst, Egan, Shaw, Hill, Cai, Morris, Willer, Liang & Bernstein. "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals." [Manuscript PDF](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf); [arXiv v3](https://arxiv.org/abs/2411.10109v3) | The anchor paper: grounding an agent in one person's own data beats demographics. Read the 2026 version, not the 2024 one. |
| 4 | Peng, T., Gui, G., Brucks, M., Merlau, D.J., Fan, G.J., Ben Sliman, M., et al. (2025). "Digital Twins as Funhouse Mirrors: Five Key Distortions." [arXiv:2509.19088](https://arxiv.org/abs/2509.19088) | The reality check: twins predict individuals on new questions only weakly (r = 0.20). Names the five ways they distort. Preprint. |
| 5 | Kazinnik, S. & Sinclair, T.M. (2026). "FOMC In Silico: A Multi-Agent System for Monetary Policy Decision Modeling." [NBER conference version](https://conference.nber.org/conf_papers/f244384.pdf) | The most complete attempt to simulate named policymakers, with a memorization test and "what if" experiments. Working paper. |
| 6 | Kreutner, M., Lutz, M. & Strohmaier, M. (2026). "Persona-driven Simulation of Voting Behavior in the European Parliament with Large Language Models." *Findings of EACL 2026*. [doi:10.18653/v1/2026.findings-eacl.25](https://doi.org/10.18653/v1/2026.findings-eacl.25) | Peer-reviewed legislator simulation with released data, and a frank note on the model's political bias. |
| 7 | Alur, Stadie, Kang, … Sekhon (Bridgewater AIA Labs) (2025). "AIA Forecaster: Technical Report." [arXiv:2511.07678](https://arxiv.org/abs/2511.07678) | A hedge fund's own test: AI matches superforecasters but not markets, and AI plus market beats market alone. |
| 8 | Lopez-Lira, Tang & Zhu (2025). "The Memorization Problem: Can We Trust LLMs' Economic Forecasts?" [arXiv:2504.14765](https://arxiv.org/abs/2504.14765) | Explains why backtests of LLMs on the past can't be trusted. Essential before believing any accuracy number. |

## 8. What the research implies for building Politik

**The research supports a tool that reads policymakers' public records, models them individually, shows its numbers next to market and crowd numbers, and proves itself with a live record.** It does not support a tool that claims to out-predict markets on scheduled decisions, or one that replaces polls with synthetic voters. These are design inferences drawn from the notes, not documented practice.

| Principle | Evidence | What it means for Politik |
|---|---|---|
| Ground each actor in their own record | Self-report agents beat demographic agents (0.83 vs 0.74) and narrowed ideological accuracy gaps (13.75% to 8.60%) ([Park et al.](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)). Off-the-shelf models drift to neutral without grounding ([Digital Pantheon](https://arxiv.org/abs/2607.15095)). | Build each official's profile from their speeches, votes, testimony and dissents, not from party or job title. |
| Show the market or crowd number beside the model | Kalshi was perfect one day before Fed meetings ([FEDS 2026-010](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm)). AI plus market beat market alone ([AIA Forecaster](https://arxiv.org/abs/2511.07678)). | Display market-implied odds first; present the model as a second opinion and an explanation. |
| Beat simple baselines | Party line predicts most legislative votes; base rates (4–6% of bills pass; FDA follows advisers 88%) are strong starting points. FOMC In Silico reports no comparison with futures. | Show the baseline (party line, base rate, Taylor rule, market price) next to every model forecast. |
| Test honestly | GPT-4o recalled 97.2% of past Fed decisions ([Kazinnik & Sinclair](https://conference.nber.org/conf_papers/f244384.pdf)); backtests mislead ([Lopez-Lira et al.](https://arxiv.org/abs/2504.14765)). | Keep a public, dated log of forecasts made before decisions, and score it with Brier scores. |
| Shrink and calibrate | Agents inflated effect sizes (2.97 vs 0.36) ([Park et al.](https://framerusercontent.com/assets/O58kycNpoOyrpQ2MgGDHbv2934.pdf)); LLM ensembles lean toward "yes" ([Schoenegger et al.](https://doi.org/10.1126/sciadv.adp1528)). | Calibrate probabilities against real outcomes, and treat simulated effect sizes as directions, not magnitudes. |
| Use simulation for "what if" questions | Swapping 4 of 12 FOMC members moved rates by 168 bp, more than changing the chair. Markets are weakest at regime changes, like the Warsh Fed dropping forward guidance. | The tool's distinct value is in new members, new leaders, pressure scenarios and changed rules, where history-based models break. |
| Start with the mature layer: reading text | Hawk/dove scoring and statement comparison work now ([JPMorgan](https://www.bnnbloomberg.ca/jpmorgan-s-ai-puts-25-years-of-fed-speeches-into-a-hawk-dove-score-1.1912721)); AI cut previews from two days to 30 minutes ([Bloomberg](https://www.bloomberg.com/news/articles/2024-08-14/hedge-funds-battle-to-turn-chatgpt-from-intern-to-analyst)); AI assistants made forecasters 24–28% more accurate. | Ship summarising, scoring and "what changed since last time" features before full simulations. |
| Treat synthetic publics as a sketchpad | Twins correlate only r = 0.20 with individuals on new outcomes ([Funhouse Mirrors](https://arxiv.org/abs/2509.19088)); Aaru's AI poll called 2024 wrong. | Use simulated stakeholders to explore how a message might land, never as a substitute for real polling. |
| Stay on public information | No law specifically governs political intelligence, but insider-trading law applies ([GAO](https://www.gao.gov/products/gao-13-389)); 2026 prediction-market insider cases led to a Senate betting ban ([PBS](https://www.pbs.org/newshour/politics/senate-bans-members-and-staff-from-betting-in-prediction-markets)). | Feed the tool only public records. Notes from private conversations with officials bring back legal risk. |

One more caution fits a tool built *for* policymakers. Simulating named, real people raises consent and privacy questions that the notes found largely unaddressed in law or guidance. Park et al. kept their individual agents private for exactly this reason.

## 9. Claims to treat with care

**Several facts in this report rest on unreviewed papers, single sources or conflicting reports.**

| Claim | Problem |
|---|---|
| Park et al. published in *Nature* | Not confirmed as of October 2026. The PDF is formatted for *Nature*; arXiv v3 carries the new title. The LLM used is not named in the main text. |
| Park et al.'s "85%" | Outdated 2024 figure; the current version reports 83% (interview) and 86% (combined). |
| FOMC In Silico accuracy (about 91%, 8.3 bp) | Working paper, versions differ, backtest only, only 22 post-cutoff meetings, no comparison with market pricing. |
| FedSight AI's 93.75% | Tiny 2023–2024 sample, likely 15 of 16 meetings. |
| Takano et al. vs Collodel arXiv numbers | One set of notes mixed up arXiv 2511.02469 and 2508.13635. This report uses the IDs checked against arXiv: Takano = 2511.02469, Collodel = 2508.13635. |
| Kalshi's perfect record | Not peer-reviewed; sources disagree whether the sample ends June 2024 or June 2025. |
| FedWatch mechanics | CME's own methodology page returned an error; mechanics come from replications. |
| Several classic papers (Taylor 1993; Gürkaynak, Sack & Swanson 2007; Malmendier, Nagel & Yan; Lucca & Trebbi) | Cited from background knowledge; links not re-opened during research. |
| Superforecasters ~30% better than intelligence analysts | Press-reported and approximate; a 2024 reanalysis contests the training and teaming effects. |
| Bueno de Mesquita model "90% accurate" | Self-reported by a former CIA analyst; never independently audited. |
| Policy research firms' rankings | Self-reported; no audited track records found. |
| Polymarket's US relaunch date | Sources conflict (December 2025 vs May 2026). |
| Kalshi ~$22bn valuation and ICE $2bn commitment | From a low-reliability source; not used in the body. |
| Medicare drug picks "13 of 15" in later rounds | Secondary source. |
| Capri/Tapestry and Albertsons/Kroger outcomes | Not verified. |
| September 2026 hike "expected by markets" | Secondary sources only. |
| Hires at Brevan Howard, Bridgewater, Rokos | Could not be verified. |
| Stillwell & Harrington Supreme Court study | Only the abstract was accessed. |
| ForecastBench at ICLR 2025; EconAgent at ACL 2024 | Venues reported but not verified. |
| Lightning Rod's "AI equals superforecasters" claim | From a company that sells forecasting models. |
| Citing-paper list for Park et al. | Drawn from one arXiv-leaning index; journal citers may be missing. |
| Liu et al. "Lost in the Middle" | Park et al. cite a different volume and pages than Crossref lists. |

## Conclusion

The research reveals a quiet shift in where the forecasting edge lives. For decades it came from proximity: ex-officials, well-sourced journalists, lobbyists and, at worst, leaks. That channel has been squeezed by the STOCK Act, by ethics scandals and by blackout rules, and part of it has migrated onto prediction markets, which now price scheduled decisions almost perfectly and occasionally carry leaked information themselves. What remains open is modelling *individual* decision-makers from their public records. That is exactly where Park et al.'s core insight lands: specific, individual data beats labels, and a well-chosen structured profile gets most of the way.

The evidence also sets a hard ceiling on claims. AI agents get directions and averages right but exaggerate magnitudes and flatten individuals. Every policymaker simulation so far is a backtest on a model that may remember the answers, and none has been measured against the market. So the realistic opportunity is not to beat markets on the next decision. It is to explain *why* a decision is likely, to stress-test *what if* the cast or the rules change, and to earn trust through a public, dated record of calls. The first tool to publish such a record for policy decisions will set the standard the field currently lacks.
