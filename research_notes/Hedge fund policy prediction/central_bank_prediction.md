# How Hedge Funds and Professional Investors Predict Central Bank Policy Decisions (Fed, ECB, BoE, BoJ)

*Research notes compiled 15 October 2026. Facts are labelled with dates where they may go stale. A few well-known academic citations come from background knowledge, and their URLs were not re-opened in this session. Those are marked "(background knowledge; URL not re-opened)" so the report writer can weigh them. Every other item was found or confirmed through search or fetch in this session.*

**Quick glossary (for the learning reader):**
- **bp:** a basis point, 0.01 percentage point.
- **FOMC:** Federal Open Market Committee, the Fed's rate-setting committee.
- **EFFR:** effective federal funds rate, the actual overnight interbank rate the Fed targets.
- **SOFR:** Secured Overnight Financing Rate, an overnight repo rate.
- **OIS:** overnight indexed swap, a swap that exchanges a fixed rate for the compounded overnight rate. It is the cleanest market gauge of the expected policy-rate path. The overnight rates OIS reference are €STR in the euro area, SONIA in the UK and TONA in Japan.
- **Term premium / risk premium:** the extra compensation investors demand for bearing interest-rate risk. It drives a wedge between market prices and true expectations.
- **SEP / "dot plot":** the Fed's quarterly Summary of Economic Projections, in which each FOMC participant's rate projection appears as a dot.
- **Forward guidance:** a central bank's statements about its likely future policy.
- **Nowcast:** a model estimate of a current-quarter or current-month data release before it is published.

---

## 1. Market-implied probabilities: how futures, OIS and options become rate-decision probabilities, and their known biases

### Takeaway
The workhorse is simple arithmetic. A futures or OIS price implies an average overnight rate over a period. Splitting that period at the meeting date backs out the expected post-meeting rate, and dividing the implied change by the step size (usually 25 bp) gives a "probability". CME FedWatch does this with 30-day fed funds futures. The Atlanta Fed and others use SOFR options to get full distributions. Researchers have long shown that these prices are *risk-adjusted* forecasts, not pure expectations. Piazzesi & Swanson (2008) find countercyclical risk premia. Schmeling, Schrimpf & Steffensen (2022) counter that most of the excess return is really systematic expectation error, especially in easing cycles. Even so, fed funds futures remain among the best short-horizon predictors.

### Cited Findings

**CME FedWatch mechanics**
- FedWatch derives its probabilities from 30-day fed funds (ZQ) futures. Each contract settles on the *average* daily EFFR in its month, and the implied rate is 100 minus the price: a price of 95.67 implies an average EFFR of 4.33%. — [CME Group, "Understanding the CME Group FedWatch Tool Methodology" (2023)](https://www.cmegroup.com/articles/2023/understanding-the-cme-group-fedwatch-tool-methodology.html) (page returned HTTP 503 when fetched; content taken from search-engine extract)
- CME says the tool computes *unconditional* probabilities of FOMC outcomes using a **binary probability tree**. Its assumptions:
  - Moves come in 25 bp steps, and EFFR moves one-for-one with the target.
  - For a month containing a meeting, that month's contract is used to infer the hike or cut probability.
  - Each month's projected ending EFFR equals the next month's starting EFFR.
  - The probability of a hike (or cut) is the sum of the probabilities of all target levels above (or below) the current one.

  CME notes that results "may be subject to variation if any tenet is compromised." — [CME methodology](https://www.cmegroup.com/articles/2023/understanding-the-cme-group-fedwatch-tool-methodology.html); [CME fed funds futures probability tree calculator](https://www.cmegroup.com/education/demos-and-tutorials/fed-funds-futures-probability-tree-calculator.html)
- Independent replications describe the meeting-month step the same way. The month's implied average is a day-weighted blend of the pre-meeting and post-meeting rates: Avg = (d/N)·R_pre + ((N−d)/N)·R_post, where d is the number of days before the change takes effect and N is the days in the month. Solving for R_post gives the implied move, and (R_post − R_pre)/0.25 gives the probability of a 25 bp move. The tree then doubles its paths at each later meeting. — [centralbank.watch "CME Expanding Tree Methodology"](https://centralbank.watch/general-models/expanding-tree-method/); [pyfedwatch (PyPI)](https://pypi.org/project/pyfedwatch) (unofficial replications)

**Options-based full distributions**
- The **Atlanta Fed Market Probability Tracker** estimates full probability distributions for future policy rates from CME options on three-month compounded SOFR. It shows the four nearest quarterly contracts and updates daily. — [Atlanta Fed, Market Probability Tracker](https://www.atlantafed.org/cenfis/market-probability-tracker); ["What to know" page](https://www.atlantafed.org/research-and-data/data/market-probability-tracker/what-to-know)
- **Why options matter:** a futures price is only a probability-weighted *mean*, so FedWatch's two-outcome tree cannot show fat tails such as a 50 bp move. Options are needed to see the whole distribution. — [macromodels Substack (third-party commentary)](https://macromodels.substack.com/p/reliably-bad-reliable-sources/comments)

**Survey benchmark that funds compare against**
- The New York Fed merged its **Survey of Primary Dealers** (run 2002–2024) and **Survey of Market Participants** into a single **Survey of Market Expectations** in January 2025. It is fielded before each FOMC meeting, FOMC participants are not consulted on its questions, and the underlying data are published. — [NY Fed, Survey of Market Expectations](https://www.newyorkfed.org/markets/primarydealer_survey_questions); [NY Fed FAQs](https://www.newyorkfed.org/markets/market-intelligence/survey-of-market-expectations/faqs-survey-of-market-expectations); [NY Fed Desk operating statement, 13 Jan 2025](https://www.newyorkfed.org/markets/opolicy/operating_policy_250113)

**Biases: term and risk premia, and the research on them**
- **Piazzesi & Swanson, "Futures Prices as Risk-Adjusted Forecasts of Monetary Policy," *Journal of Monetary Economics* 55 (2008): 677–691.** Earlier versions are NBER w10547 (2004) and FRBSF WP 2006-23.
  - Fed funds futures earn **positive average excess returns** that are **higher in weak economic times** (countercyclical).
  - Those excess returns are predictable from employment growth and from financial business-cycle indicators such as Treasury yield spreads and corporate bond spreads. Eurodollar futures show the same pattern.
  - "Simply ignoring these risk premia significantly biases forecasts of the future path of monetary policy," and risk premia contaminate some futures-based measures of policy shocks.

  — [FRBSF working paper page](https://www.frbsf.org/research-and-insights/publications/working-papers/futures-prices-as-risk-adjusted-forecasts-of-monetary-policy); [NBER w10547 PDF](https://www.nber.org/papers/w10547.pdf); [author PDF](https://web.stanford.edu/~piazzesi/fff.pdf)
- **Schmeling, Schrimpf & Steffensen, "Monetary Policy Expectation Errors," *Journal of Financial Economics* 146(3) (2022): 841–858.**
  - Using surveys to split money-market excess returns, they find that excess returns come **mostly from expectation errors, not term premia**, which are small.
  - Their explanation: investors find it hard to learn how the Fed reacts to rare, large negative shocks, so they **underestimate how far the Fed will cut**.
  - These errors make past stock returns predict money-market returns, in the US and internationally.

  — [City, Univ. of London accepted manuscript](https://openaccess.city.ac.uk/id/eprint/30048/); [BIS Working Paper 996](https://www.bis.org/publ/work996.pdf)
- **Gürkaynak, Sack & Swanson, "Market-Based Measures of Monetary Policy Expectations," *Journal of Business & Economic Statistics* 25(2) (2007).** Federal funds futures dominate other market-based measures, such as eurodollar futures, Treasury bills and commercial paper, for forecasting policy out to several months. — [DOI 10.1198/073500106000000387](https://doi.org/10.1198/073500106000000387) (background knowledge; URL not re-opened)
- **Kuttner, "Monetary policy surprises and interest rates: Evidence from the Fed funds futures market," *Journal of Monetary Economics* 47(3) (2001).** This is the canonical method for extracting the *unexpected* part of a rate decision from the change in the current-month fed funds futures price on announcement day, scaled up by days remaining in the month. — [DOI 10.1016/S0304-3932(01)00055-1](https://doi.org/10.1016/S0304-3932(01)00055-1) (background knowledge; URL not re-opened)

**Prediction markets as a new benchmark (2025–2026)**
- **Diercks, Katz & Wright, "Kalshi and the Rise of Macro Markets."** Issued as Federal Reserve FEDS 2026-010 (12 Feb 2026) and as NBER Working Paper w34702 (Jan 2026); not peer reviewed.
  - The Kalshi median and mode had "a perfect forecast record on the day before the FOMC meeting," described as "a statistically significant improvement over the Fed funds futures forecast."
  - Kalshi was "on par" with Wall Street forecasters, and its inflation and unemployment forecast errors were "almost the same" as the Bloomberg consensus.
  - The authors call Kalshi "a high-frequency, continuously updated, distributionally rich benchmark."

  — [Federal Reserve FEDS 2026-010 page](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm); [PDF](https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf); [Fortune, 28 Jan 2026](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/); [Bloomberg, 28 Jan 2026](https://www.bloomberg.com/news/articles/2026-01-28/kalshi-fed-forecasts-are-as-good-as-wall-street-s-study-says)
- **Sample-period conflict.** Fortune reports the FOMC sample as 2022 through June 2025. A search-engine summary of the same coverage said "2022 through June 2024." The report writer should check the paper. Much of Kalshi's edge comes from **September 2024**, when Kalshi correctly priced the 50 bp cut while other forecasters were split. — [Fortune](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/)
- A CEPR analysis takes a more measured view: prediction-market prices are useful indicators but may contain pricing biases. — reported in [search coverage of the debate](https://gizmodo.com/federal-reserve-says-prediction-markets-are-a-valuable-tool-for-policymakers-2000724062) (original CEPR piece not opened)

### Inferences
- In practice, "the market is pricing X% for a cut" almost always means the FedWatch-style mean-to-probability conversion. Because only two adjacent outcomes are allowed, a reading such as "60% for 25 bp" can equally reflect a 30% chance of 50 bp and a 70% chance of no move. Professionals read options-implied distributions (Atlanta Fed tracker, SOFR options, swaptions) and Kalshi or Polymarket ladders alongside it.
- The same conversion carries over to other central banks using meeting-dated OIS: €STR for the ECB, SONIA for the BoE, TONA for the BoJ. Terminals such as Bloomberg (its WIRP function) publish these tables. That is industry knowledge, not verified in this session.
- The academic split between "risk premium" (Piazzesi–Swanson) and "expectation error" (Schmeling et al.) matters in practice. If premia dominate, a fund can mechanically adjust futures-implied paths. If errors dominate, as in easing cycles, the edge comes from a better model of the Fed's reaction function than the market has. That second reading is what discretionary macro funds claim to have.

### Gaps
- Could not open CME's methodology page (HTTP 503), so the exact current treatment of month-end effects, the EFFR-to-target spread and late-month meetings is drawn from replications.
- Found no primary documentation of how specific hedge funds de-bias market-implied paths; this is proprietary.
- No Polymarket-specific accuracy study on Fed decisions was found.

---

## 2. Rule-based models, central bank projections, nowcasting and why data surprises matter

### Takeaway
Funds anchor forecasts in an estimated **reaction function**: how the central bank sets rates given inflation, unemployment or output gaps, financial conditions and its own projections. Taylor-type rules and the central bank's own forecasts, such as the Fed's SEP dot plot, are the starting point. Public **nowcasts** (Atlanta Fed GDPNow, Cleveland Fed inflation nowcast, NY Fed Staff Nowcast) and private and alternative data then let traders anticipate the data the committee will see. Funds care about *surprises* relative to consensus because, per Bauer & Swanson, a large part of what looks like a "monetary policy surprise" is actually the Fed reacting to economic news the market under-weighted.

### Cited Findings

**Taylor rules and reaction functions**
- **Taylor (1993), "Discretion versus policy rules in practice," *Carnegie-Rochester Conference Series on Public Policy* 39: 195–214.** The original rule: i = r* + π + 0.5(π − 2) + 0.5·(output gap), with r* = 2%. — [DOI 10.1016/0167-2231(93)90009-L](https://doi.org/10.1016/0167-2231(93)90009-L) (background knowledge; URL not re-opened)
- **Clarida, Galí & Gertler (2000), "Monetary Policy Rules and Macroeconomic Stability: Evidence and Some Theory," *QJE* 115(1).** Estimates forward-looking rules and finds that the post-1979 Fed raised real rates in response to higher expected inflation (coefficient > 1) while the pre-1979 Fed did not. This is the template for estimating reaction functions. — [DOI 10.1162/003355300554692](https://doi.org/10.1162/003355300554692) (background knowledge; URL not re-opened)
- The Fed publishes its own reference set of simple rules (Taylor 1993, "balanced-approach," inertial and first-difference rules) on its page "Policy Rules and How Policymakers Use Them." The Atlanta Fed's **Taylor Rule Utility** and the Cleveland Fed's **Simple Monetary Policy Rules** let users vary the inputs. — [Federal Reserve Board](https://www.federalreserve.gov/monetarypolicy/policy-rules-and-how-policymakers-use-them.htm); [Atlanta Fed Taylor Rule Utility](https://www.atlantafed.org/cqer/research/taylor-rule) (background knowledge; URLs not re-opened)
- **Shapiro & Wilson, "Taking the Fed at its Word: A New Approach to Estimating Central Bank Objectives using Text Analysis," *Review of Economic Studies* (2022; forthcoming as of Nov 2021).** Estimates the Fed's loss function, including its implicit inflation target, from the sentiment of FOMC transcripts, minutes and speeches rather than from rate data. — [Replication package, Zenodo v3.0 (30 Nov 2021)](https://zenodo.org/records/5598429). The specific estimates were not verified this session. From background knowledge: an implicit target of roughly 1.5% for the 1990s–2000s and an asymmetric loss function, *to be checked*.

**Central bank projections (dot plot / SEP)**
- **Engstrom, "Anchored to the Dot Plot: Central Bank Projections and Interest Rate Expectations," FEDS 2026-026 (May 2026).**
  - SEP fed funds projections, published since January 2012, forecast **better than consensus surveys, VAR models and several market-based measures at many horizons**.
  - Because the SEP is updated only quarterly, its projections go stale. Survey forecast errors, and to a weaker degree market errors, are **systematically related to the gap between current expectations and lagged SEP dots**, so official guidance "can improve average forecast accuracy while slowing how quickly new information is incorporated."

  — [Federal Reserve FEDS 2026-026](https://www.federalreserve.gov/econres/feds/anchored-to-the-dot-plot-central-bank-projections-and-interest-rate-expectations.htm)
- **Counterpoint (practitioner):** a CIBC note (mid-2026) reports that over ten years of June SEPs, the year-end funds rate matched the median dot for the current year only **36%** of the time and for the next year about **10%** of the time. — [CIBC Wood Gundy, "Ditch the dots"](https://woodgundyadvisors.cibc.com/documents/506868/506932/Ditch+the+dots.pdf/21ec8ab0-97a0-4d15-928b-a0c868f9a630)
- **Reifschneider & Tulip (2017), FEDS 2017-020.** Use historical root-mean-squared errors to size the uncertainty around FOMC projections and conclude that "considerable uncertainty surrounds all macroeconomic projections," including the FOMC's. — [DOI 10.17016/FEDS.2017.020](https://doi.org/10.17016/FEDS.2017.020)
- A Riksbank staff memo (2017) notes that the dots are not forecasts in a strict sense, that FOMC projections have tended to **overestimate** future rates, and that errors are of similar magnitude across central banks. — [Riksbank staff memo (2017)](https://www.riksbank.se/globalassets/media/rapporter/staff-memo/svenska/2017/staff_memo1_repoforecast_170620.pdf)

**Nowcasting**
- **Atlanta Fed GDPNow** (methodology: Higgins 2014, Atlanta Fed WP 2014-7). For final nowcasts of initial GDP estimates from 2011:Q3 to 2025:Q2, the **average absolute error is 0.77 pp and the RMSE is 1.17 pp**; an earlier version, through 2022:Q3, reported 0.82/1.22. Before the pandemic, GDPNow and the WSJ survey both had average absolute errors of about 0.5 pp. GDPNow is not an official Atlanta Fed forecast. — [Atlanta Fed GDPNow](https://www.atlantafed.org/cqer/research/gdpnow); [Atlanta Fed, "Evaluation of GDP nowcasts during pandemic" (2022)](https://www.atlantafed.org/research-and-data/publications/policy-hub-macroblog/2022/05/19/evaluation-of-gdp-nowcasts-during-pandemic); [GDPNow FAQ](https://www.atlantafed.org/cqer/research/gdpnow/tab_FAQs)
- **Cleveland Fed Inflation Nowcasting** (Knotek & Zaman).
  - Daily nowcasts of headline and core CPI and PCE since early 2014.
  - The original paper (WP 14-03; published in *Journal of Money, Credit and Banking*, 2017) found the CPI and PCE nowcasts significantly beat the Survey of Professional Forecasters for headline inflation, with similar accuracy for core, and were broadly comparable to the Fed Board's Greenbook.
  - WP 24-06 (March 2024) finds a fairly simple mixed-frequency model (one that combines daily oil and gasoline prices with monthly data) more accurate than professional surveys for headline inflation and competitive for core.

  — [Cleveland Fed WP 24-06](https://www.clevelandfed.org/publications/working-paper/2024/wp-2406-nowcasting-inflation); [Cleveland Fed WP 14-03](https://www.clevelandfed.org/publications/working-paper/2015/wp-1403r-nowcasting-us-headline-and-core-inflation); [Cleveland Fed press release, 6 Mar 2023](https://www.clevelandfed.org/collections/press-releases/2023/pr-20230306-cleveland-feds-inflation-nowcasting-model)
- **Alternative data under stress (Oct 2025 shutdown).** The federal shutdown that began 1 Oct 2025 suspended nearly all BLS operations, delaying the September jobs report. Markets fell back on:
  - **ADP** private payrolls, which showed −32k in September;
  - the Chicago Fed's new **real-time unemployment-rate estimate**, about 4.3% (4.34%) for September 2025, built from 11 public and private indicators and updated every two weeks.

  Chicago Fed President Goolsbee cautioned that "the BLS numbers are the best labor market numbers in the world." — [Benzinga, Oct 2025](https://www.benzinga.com/markets/economic-data/25/10/48011288/bls-data-halts-but-chicago-fed-sees-steady-4-34-unemployment-private-sources-flag-low-fire-low-hire-holiday-risk); [AP via TheGrio, 3 Oct 2025](https://thegrio.com/2025/10/03/lack-of-jobs-data-due-to-government-shutdown-muddies-view-of-hiring-and-the-us-economy/); [J.P. Morgan](https://www.jpmorgan.com/insights/markets-and-economy/economy/september-jobs-report-delayed-government-shutdown)

**Why data surprises matter: the "Fed response to news" channel**
- **Bauer & Swanson, "A Reassessment of Monetary Policy Surprises and High-Frequency Identification," *NBER Macroeconomics Annual* 2022, vol. 37.**
  - High-frequency FOMC surprises are **correlated with macroeconomic and financial data public before the announcement**, so markets systematically under-predict how strongly the Fed responds to news.
  - Their fix is to orthogonalize surprises against prior data and to add **Fed Chair speeches** as events, which doubles the number and importance of announcements.
  - Asset-price effects of policy are largely unchanged, while estimated macro effects are larger and more significant.

  — [NBER chapter](https://www.nber.org/books-and-chapters/nber-macroeconomics-annual-2022-volume-37/reassessment-monetary-policy-surprises-and-high-frequency-identification); [NBER w29939](https://www.nber.org/papers/w29939); [U. Chicago Press DOI 10.1086/723574](https://www.journals.uchicago.edu/doi/10.1086/723574)
- **Bauer & Swanson, "An Alternative Explanation for the 'Fed Information Effect'," *AER* 113(3) (2023).** The apparent "information effect" of Nakamura & Steinsson, where a hike raises private growth forecasts, is better explained by the Fed and the forecasters both reacting to the same strong economic news. — [AEA page](https://www.aeaweb.org/articles?id=10.1257/aer.20201220) (background knowledge; URL not re-opened)
- **Andersen, Bollerslev, Diebold & Vega, "Micro Effects of Macro Announcements," *AER* 93(1) (2003).** The classic evidence that data surprises relative to survey consensus, especially payrolls, move bond and FX prices within minutes. — [DOI 10.1257/000282803321455151](https://doi.org/10.1257/000282803321455151) (background knowledge; URL not re-opened)

### Inferences
- The professional workflow is roughly: (1) estimate a reaction function from rules, the SEP and text such as Shapiro–Wilson; (2) feed it nowcasts and alternative data to predict incoming releases; (3) compare the implied path with market pricing (Section 1); (4) trade the gap. Engstrom (2026) and Bauer & Swanson (2022/2023) together imply the main exploitable inefficiencies are **under-reaction to news** and **over-anchoring on stale dots**.
- The 2025 shutdown episode shows why funds buy alternative data (payroll processors, job postings, card spending). It also shows that alternative data mostly substitutes for labour data, not inflation data.
- Balance-sheet decisions (QE/QT pace) are forecast less from rules and more from communication: minutes, Desk statements and survey questions. The Survey of Market Expectations includes balance-sheet questions; this is from background knowledge and was not re-verified.

### Gaps
- No source verified the specific Shapiro–Wilson estimates of the implicit inflation target.
- Did not verify NY Fed Staff Nowcast accuracy statistics.
- No systematic public evidence was found on how much individual funds' proprietary nowcasts outperform the public ones.

---

## 3. "Fedspeak" and communication analysis: text mining, NLP and LLMs, and mapping hawks and doves

### Takeaway
Reading central bank communication evolved in three stages:
1. Human "Fed watchers" parsing statement wording.
2. Dictionary and topic-model methods (Lucca–Trebbi 2009; Hansen–McMahon 2016; Hansen–McMahon–Prat 2018), which made text quantitative.
3. Since 2023, transformer and LLM classifiers. These include the Trillion Dollar Words benchmark, Hansen–Kazinnik on GPT, BIS CB-LMs, JPMorgan's Hawk-Dove Score, and multi-agent "FOMC in silico" simulations that try to predict the decision itself.

Non-verbal channels (voice tone, facial expression) also move markets. Member-level hawk/dove maps (Bordo–Istrefi) and life-experience predictors (Malmendier–Nagel–Yan) underpin dissent and vote prediction.

### Cited Findings

**Classic text-as-data on central banks**
- **Lucca & Trebbi (2009), "Measuring Central Bank Communication: An Automated Approach with Application to FOMC Statements," NBER WP 15367.** Scores statement hawkishness by matching phrases against Google/Factiva news to see how they are interpreted. Finds that changes in statement wording move longer-term Treasury yields and predict future policy-rate decisions. — [NBER w15367](https://www.nber.org/papers/w15367) (background knowledge; URL not re-opened)
- **Hansen & McMahon (2016), "Shocking Language: Understanding the Macroeconomic Effects of Central Bank Communication," *Journal of International Economics* 99 (Suppl. 1).** Topic modelling of FOMC statements; finds forward guidance matters more than statements about current conditions. — [DOI 10.1016/j.jinteco.2015.12.008](https://doi.org/10.1016/j.jinteco.2015.12.008) (background knowledge; URL not re-opened)
- **Hansen, McMahon & Prat (2018), "Transparency and Deliberation within the FOMC: A Computational Linguistics Approach," *QJE* 133(2): 801–870.**
  - Uses the **1993 decision to publish FOMC transcripts** as a natural experiment and applies Latent Dirichlet Allocation (an unsupervised topic model) to deliberations.
  - Finds both a *discipline effect* (members prepare more) and a *conformity effect* (inexperienced members converge to the consensus). On net, discipline dominates.

  — [LSE Research Online](https://researchonline.lse.ac.uk/id/eprint/58072); [UPF WP 1425](https://econ-papers.upf.edu/papers/1425.pdf); [DOI 10.1093/qje/qjx045](https://doi.org/10.1093/qje/qjx045)
- **Cieslak & Vissing-Jorgensen (2021), "The Economics of the Fed Put," *Review of Financial Studies* 34(9).** Text analysis of FOMC minutes and transcripts shows that stock-market declines feed into the Fed's growth outlook and predict easing (the "Fed put"). This is a core input for funds forecasting cuts after sell-offs. — [DOI 10.1093/rfs/hhaa114](https://doi.org/10.1093/rfs/hhaa114) (background knowledge; URL not re-opened)
- **Aruoba & Drechsel, "Identifying Monetary Policy Shocks: A Natural Language Approach,"** NBER WP 32417 (May 2024), also CEPR DP 17133; listed as forthcoming in *AEJ: Macroeconomics*.
  - Applies NLP to the documents **Fed staff prepare before meetings** (Greenbook/Tealbook) to capture the Fed's information set, then uses machine learning to predict target changes. The residual is the policy shock.
  - The text contains "essential information about the economy which is not captured by numerical forecasts."

  — [NBER w32417](https://www.nber.org/papers/w32417); [VoxEU column](https://voxeu.org/voxeu/columns/identifying-monetary-policy-shocks-natural-language-approach); [CEPR DP17133](https://repec.cepr.org/repec/cpr/ceprdp/DP17133.pdf)

**Non-verbal communication**
- **Gorodnichenko, Pham & Talavera (2023), "The Voice of Monetary Policy," *AER* 113(2): 548–584** (NBER w28592; CEPR DP 15932). Uses machine-learning analysis of the **vocal emotion** of Fed Chairs in press conferences and finds that voice tone moves asset prices beyond the words spoken. — [RePEc listing](https://ideas.repec.org/p/bir/birmec/21-02.html); [Gorodnichenko homepage](https://eml.berkeley.edu/~ygorodni/)
- **Curti & Kazinnik (2023), "Let's Face It: Quantifying the Impact of Nonverbal Communication in FOMC Press Conferences," *Journal of Monetary Economics* 139: 110–126.** Uses facial-recognition scoring of Chair expressions aligned with minute-level asset data. "Investors adversely react to negative expressions," with lower S&P 500 and higher VIX, even after controlling for words. Citing papers note no significant effect on *rate expectations*. — [RePEc/JME](https://ideas.repec.org/a/eee/moneco/v139y2023icp110-126.html)

**LLM-era research (2023–2026)**
- **Shah, Paturi & Chava (2023), "Trillion Dollar Words: A New Financial Dataset, Task & Market Analysis," ACL 2023.** Defines the **hawkish–dovish classification task** with an annotated FOMC dataset of statements, minutes and speeches; RoBERTa-large performed best. It is the standard baseline for later work. — [ACL Anthology author page](https://aclanthology.org/people/suvan-paturi); [review summary](https://liner.com/review/trillion-dollar-words-new-financial-dataset-task-market-analysis)
- **Hansen & Kazinnik, "Can ChatGPT Decipher Fedspeak?"** (SSRN, March 2023; Richmond Fed / Fed System research, 2024).
  - GPT models classify the policy stance of FOMC announcements better than BERT and dictionary methods, and GPT-4 gives human-like rationales.
  - The authors caution that it can miss nuance and is better as an analyst aid than a replacement. They also apply it to Romer–Romer-style narrative shock identification.

  — [FRBSF / Fed System Research](https://www.frbsf.org/research-and-insights/publications/system-research-richmond-fed/2024/03/can-chatgpt-decipher-fedspeak/); [Axios, 17 Apr 2023](https://www.axios.com/2023/04/17/new-chatgpt-task-deciphering-fed-messages)
- **Gambacorta, Kwon, Park, Patelli & Zhu, "CB-LMs: Language Models for Central Banking," BIS Working Paper 1215 (Oct 2024).** BERT and RoBERTa models retrained on central bank speeches, policy documents and research. Some beat general-purpose generative LLMs at classifying FOMC stance. The largest LLMs win on harder tasks, such as sentiment in long news articles, but raise confidentiality, replicability and cost issues. — [BIS WP 1215](https://www.bis.org/publ/work1215.htm)
- **JPMorgan "Hawk-Dove Score" (April 2023).** A ChatGPT-based model built by economists led by Joseph Lupton, trained on 25 years of Fed statements and speeches.
  - A **10-point rise in the Fed score mapped to roughly a 10-percentage-point higher probability of a 25 bp hike** at the next meeting.
  - Rising inter-meeting hawkishness preceded more hawkish statements and higher one-year yields.
  - Extended to the ECB and BoE, with plans for 30+ central banks. JPMorgan called preliminary results "encouraging."

  — [BNN Bloomberg, 26 Apr 2023](https://www.bnnbloomberg.ca/jpmorgan-s-ai-puts-25-years-of-fed-speeches-into-a-hawk-dove-score-1.1912721); [Fortune, 28 Apr 2023](https://fortune.com/2023/04/28/jpmorgan-artificial-intelligence-chatgpt-llm-hawk-dove-federal-reserve-speak)
- **Kazinnik & Sinclair, "FOMC In Silico: A Multi-Agent System for Monetary Policy Decision Modeling"** (2025–2026; GWU working paper 2025-005; NBER conference paper; ECB forecasting conference, March 2026; AEA 2027 programme).
  - LLM agents role-play individual FOMC members using real-time macro and district data, combined with a Monte Carlo Bayesian voting model.
  - The October 2025 draft replicating the July 2025 meeting produced 4.42% (LLM) and 4.38% (Monte Carlo), near the top of the actual 4.25–4.50% range.
  - A 2026 version reports, across **218 meetings from 2000 to June 2026, a mean absolute error of 8.3 bp and 91% correct hike/hold/cut classification**, with similar accuracy before and after the model's training cutoff.
  - **Versions differ; check the latest before citing.**

  — [Stanford Digital Economy Lab](https://digitaleconomy.stanford.edu/publication/fomc-in-silico-a-multi-agent-system-for-monetary-policy-decision-modeling); [ECB conference PDF](https://www.ecb.europa.eu/press/conferences/shared/pdf/20260323_forecasting/Kazinnik_paper.pdf); [NBER conference PDF](https://conference.nber.org/conf_papers/f244384.pdf); [GWU RePEc](https://econpapers.repec.org/paper/gwcwpaper/2025-005.htm)
- **Takano, Hirano & Nakagawa, "Modeling Hawkish-Dovish Latent Beliefs in Multi-Agent Debate-Based LLMs for Monetary Policy Decision Classification,"** arXiv 2511.02469 (Nov 2025). Multi-agent LLM "FOMC members" with hawk or dove priors debate over Beige Book text and macro data to predict Raise/Hold/Lower for all scheduled meetings from January 2000 to December 2025. — [arXiv 2511.02469](https://arxiv.org/pdf/2511.02469)
- **Tang & Yang (HKUST), "Mind the Shift: Decoding Monetary Policy Stance from FOMC Statements with Large Language Models,"** arXiv 2603.14313 (Mar 2026). Uses "Delta-Consistent Scoring," which treats stance as *relative change between consecutive meetings* so no hand labels are needed. Reports up to **71.1%** sentence-level hawk/dove accuracy across four LLM backbones, beating supervised probes and LLM-as-judge. — [arXiv 2603.14313](https://arxiv.org/html/2603.14313v1)

**Mapping individual members (hawk/dove, dissent)**
- **Bordo & Istrefi (2023), "Perceived FOMC: The Making of Hawks, Doves and Swingers," *Journal of Monetary Economics*** (DOI 10.1016/j.jmoneco.2023.03.001; NBER w24650; Banque de France WP 683).
  - Uses Istrefi's newspaper-based classification of each FOMC member from the 1960s to 2015: about **39% all-time hawks, 30% all-time doves, 24% "swingers"**.
  - Hawks are more likely to have graduated from Chicago-school-linked universities. Doves more often come from Keynesian-leaning schools and were born during high-unemployment periods.

  — [NBER w24650](https://www.nber.org/papers/w24650); [Banque de France WP 683](https://www.banque-france.fr/en/publications-and-statistics/publications/perceived-fomc-making-hawks-doves-and-swingers)
- **Malmendier, Nagel & Yan, "The Making of Hawks and Doves: Inflation Experiences on the FOMC"** (NBER w23228; *Journal of Monetary Economics* 2021). Members' **lifetime inflation experience** predicts their inflation forecasts, dissents and voting. — [NBER w23228](https://www.nber.org/papers/w23228) (background knowledge; URL not re-opened)

### Inferences
- For funds, the practical output of this literature is (a) a **speaker-weighted hawk/dove index** between meetings, like JPMorgan's, built bottom-up from each member's speeches and weighted by voting status and influence, and (b) **statement "diffing"**: word-by-word changes versus the prior statement. Lucca–Trebbi and Tang–Yang's "relative stance" idea formalise (b).
- The FOMC-in-silico and Takano results suggest LLM simulations now roughly match market-implied hit rates on hold/hike/cut (about 90%). Nothing found shows they beat *day-before* market pricing, which per Diercks–Katz–Wright is already near-perfect at that horizon. Their potential edge is at longer horizons and in modelling dissents.
- Committees with genuinely split votes, notably the BoE MPC with its frequent 3-way splits, make vote-count prediction a distinct tradable question. No dedicated recent academic study of MPC vote prediction was found this session.

### Gaps
- Could not verify the publication venue or final accuracy numbers for Takano et al. (2025) or whether code or data are public for Tang & Yang (2026).
- Did not find a verified, current (2025–2026) public hawk/dove index from Bloomberg or other vendors; JPMorgan's 2023 launch is the best-documented.
- Did not verify dissent-prediction papers such as Thornton & Wheelock's history of FOMC dissents (St. Louis Fed Review, 2014) or Riboni & Ruge-Murcia (QJE 2010).
- Found no peer-reviewed evidence that any LLM classifier earns trading profits net of costs.

---

## 4. Information-flow research: the pre-FOMC drift, leaks and informal communication, and measuring policy surprises

### Takeaway
A large literature shows that central bank news does not arrive only at the scheduled announcement:
- Equities historically rallied in the 24 hours before FOMC decisions (Lucca–Moench), a pattern that has weakened since about 2015.
- Equity premia were earned in "even weeks" of the FOMC cycle, consistent with informal Fed communication (Cieslak–Morse–Vissing-Jorgensen).
- There is evidence of informed trading inside the media lock-up (Bernile–Hu–Tang).
- ECB "sources stories" move OIS rates more than on-the-record remarks (Ehrmann–Gnan–Rieder).

Separately, the surprise-measurement literature (Kuttner; Gürkaynak–Sack–Swanson; Nakamura–Steinsson; Bauer–Swanson) defines what a "surprise" is and shows that part of it is predictable.

### Cited Findings

**Pre-FOMC drift**
- **Lucca & Moench, "The Pre-FOMC Announcement Drift," *Journal of Finance* 70 (2015): 329–371** (DOI 10.1111/jofi.12196; NY Fed Staff Report 512).
  - The S&P 500 rose on average **49 bp in the 24 hours before scheduled FOMC announcements** regardless of the decision's direction.
  - Similar effects appear in other major international equity indices but **not** in Treasuries or money-market futures, and not before other macro releases.
  - Pre-FOMC returns are larger when the yield curve is flat and implied volatility is high.
  - The published abstract also states that roughly **80% of annual realized US excess equity returns since 1994** came in this window (this figure is from background knowledge of the abstract and was not re-verified).

  — [NY Fed SR512](https://www.newyorkfed.org/research/staff_reports/sr512.html); [VoxEU column](https://cepr.org/voxeu/columns/predictable-movements-asset-prices-around-fomc-meetings) (49 bp figure via search extract; page returned 403 on fetch)
- **Kurov, Wolfe & Gilbert (2021), "The Disappearing Pre-FOMC Announcement Drift," *Finance Research Letters* 40.** Extending the sample, the drift **stopped appearing reliably after 2015**: in meetings without press conferences and, from January 2016, in meetings with them. The authors attribute this to lower uncertainty. — [RePEc](https://ideas.repec.org/a/eee/finlet/v40y2021ics1544612320315956.html); [Skidmore PDF](https://www.skidmore.edu/economics/documents/KurovWolfeGilbert-TheDisappearingPre-FOMC-Announce-Drift-200914.pdf)
- **Counterpoint.** Others argue the drift is time-varying and concentrated in high-volatility regimes: about 109 bp when implied volatility is above its prior median versus about 9.7 bp below. — [Quantpedia summary of Martello & Ribeiro (2018)](https://quantpedia.com/fomc-equity-drift-occurs-in-periods-of-high-uncertainty/) (secondary)

**FOMC cycle and informal communication**
- **Cieslak, Morse & Vissing-Jorgensen, "Stock Returns over the FOMC Cycle," *Journal of Finance* 74(5) (2019): 2201–2248.**
  - Since 1994 the US equity premium has been earned **entirely in even weeks (0, 2, 4, 6) of the FOMC cycle**, counted from the last meeting.
  - The authors tie this to Fed news using intermeeting target changes, fed funds futures and internal Board meetings. Fed-funds volatility also peaks in even weeks.
  - They argue "systematic informal communication of Fed officials with the media and financial sector" is a channel, examining WSJ articles and private newsletters.

  — [Duke Scholars](https://scholars.duke.edu/publication/1136749); [SSRN 2687614](https://papers.ssrn.com/abstract=2687614); [NYU Stern PDF](https://stern.nyu.edu/sites/default/files/assets/documents/cycle_paper_cieslak_morse_vissingjorgensen.pdf)
- **Bernile, Hu & Tang (2016), "Can Information Be Locked Up? Informed Trading Ahead of Macro-News Announcements," *Journal of Financial Economics* 121(3): 496–520.**
  - Finds abnormal E-mini S&P 500 order imbalances *during FOMC media embargoes* that point in the direction of the coming surprise, using FOMC statements from Sept 1997 to June 2013.
  - No such evidence before embargoes or around payrolls, PPI or GDP lock-ups.
  - A 2014 Bloomberg report quoted estimated aggregate profits of **$14 million–$256 million** on surprise days.
  - The Fed then tightened lock-up rules, banning phones and blocking internet lines.

  — [SMU repository](https://ink.library.smu.edu.sg/lkcsb_research/4229); [Financial Advisor (Bloomberg reprint)](https://www.fa-mag.com/news/investors-may-have-gained-early-word-on-fed-policy-17953.html)
- **Journalist channel ("Fed whisperer").** On 13 June 2022, during the Fed's blackout, WSJ reporter Nick Timiraos wrote that hot inflation data likely led officials to consider a **75 bp** hike. Fed funds futures moved from about **25% to about 57%** odds of 75 bp that day, and the Fed hiked 75 bp on 15 June 2022 (decision date from background knowledge). — [Newsquawk headline, 13 Jun 2022](https://newsquawk.com/headlines/wsj-reports-a-string-of-troubling-inflation-reports-in-recent-days-is-likely-to-lead-federal-reserve-officials-to-consider-surprising-markets-with-a-larger-than-expected-0-75-percentage-point-interest-rate-increase-at-their-meeting-this-wee-13-06-2022); [investingLive (formerly ForexLive), 13 Jun 2022](https://investinglive.com/centralbank/wsj-fedwatcher-speculates-about-a-75-basis-point-hike-20220613/)
- **ECB "sources stories."** Ehrmann, Gnan & Rieder, "Central Bank Communication by 'Sources': The Economics of Public Policy Leaks," CEPR DP 18152 / ECB WP 2846 (2023); ECB Blog "Anonymous Eurosystem leaks – minor nuisance or major problem?" (19 May 2023).
  - **368 anonymous leaks** from Eurosystem insiders, 2002–2021, found in Reuters, Bloomberg and MNI. Leaks shifted from mostly pre-meeting to increasingly post-meeting and are more frequent when policymakers disagree.
  - In 35-minute windows, leaks moved OIS rates **60–95% more than normal** and **15–30% more than attributed Governing Council statements**.
  - Leaks often reflect **minority views**, reverse prior trends and usually do not move rates closer to the eventual decision. Post-press-conference leaks weaken official messaging.

  — [ECB Blog, 19 May 2023](https://www.ecb.europa.eu/press/blog/date/2023/html/ecb.blog.230519~795de9b929.en.html); [ECB WP 2846](https://www.ecb.europa.eu/pub/pdf/scpwps/ecb.wp2846~30dc1682a8.en.pdf)

**Measuring policy surprises (what funds are trying to predict)**
- **Gürkaynak, Sack & Swanson (2005), "Do Actions Speak Louder Than Words? The Response of Asset Prices to Monetary Policy Actions and Statements," *International Journal of Central Banking* 1(1).** Shows FOMC announcements carry two factors, a **"target" surprise** and a **"path" (forward guidance) surprise**, and the path factor explains most of the long-yield response. — [IJCB](https://www.ijcb.org/journal/ijcb05q2a2.htm) (background knowledge; URL not re-opened)
- **Swanson (2021), "Measuring the Effects of Federal Reserve Forward Guidance and Asset Purchases on Financial Markets," *Journal of Monetary Economics* 118.** Adds a third, **LSAP (asset-purchase) factor**. This is relevant for forecasting balance-sheet decisions. — [DOI 10.1016/j.jmoneco.2020.09.003](https://doi.org/10.1016/j.jmoneco.2020.09.003) (background knowledge; URL not re-opened)
- **Nakamura & Steinsson (2018), "High-Frequency Identification of Monetary Non-Neutrality: The Information Effect," *QJE* 133(3).** Argues FOMC surprises partly reveal Fed information about the economy: surprise tightenings *raise* private growth forecasts. — [DOI 10.1093/qje/qjy004](https://doi.org/10.1093/qje/qjy004) (background knowledge; URL not re-opened)
- **Bauer & Swanson (2022/2023).** Surprises are predictable from pre-announcement public data; the "Fed response to news" channel explains the information effect. See Section 2. — [NBER w29939](https://www.nber.org/papers/w29939)
- **Euro area equivalents:** Altavilla, Brugnolini, Gürkaynak, Motto & Ragusa (2019), "Measuring Euro Area Monetary Policy," *JME* 108, which built the Euro Area Monetary Policy Event-Study Database. Also Jarociński & Karadi (2020), "Deconstructing Monetary Policy Surprises—The Role of Information Shocks," *AEJ: Macro* 12(2). — [DOI 10.1016/j.jmoneco.2019.08.016](https://doi.org/10.1016/j.jmoneco.2019.08.016); [DOI 10.1257/mac.20180090](https://doi.org/10.1257/mac.20180090) (background knowledge; URLs not re-opened)

### Inferences
- The informal-communication literature implies part of the "forecasting" edge historically came from **proximity to information flows**: newsletters, ex-officials and well-sourced journalists. That is why blackout rules, lock-up reforms and leak scandals (Section 5) matter.
- Bauer–Swanson's predictability result is the academic justification for systematic macro strategies that trade *against* market pricing after strong or weak data runs.
- The disappearance of the pre-FOMC drift after about 2015 is a textbook example of an anomaly decaying after publication and after communication changes such as press conferences at every meeting from 2019. Funds should not treat it as a stable strategy.

### Gaps
- Could not re-verify the "~80%" Lucca–Moench statistic directly from the paper.
- Found no academic study quantifying leak effects at the BoE or BoJ comparable to the ECB study.
- Did not locate post-2023 evidence on whether even-week patterns persist.

---

## 5. Practitioner and industry side: Fed watchers, ex-central bankers at funds, sell-side, alternative data, and controversies

### Takeaway
The buy side combines:
- market pricing and surveys (NY Fed Survey of Market Expectations);
- sell-side economists' previews;
- in-house NLP and nowcasting;
- prediction markets (Kalshi);
- **access to former officials** hired as advisers or PMs: Bernanke at Citadel; Brian Sack at D.E. Shaw and then Balyasny; Simon Potter at Millennium; Kevin Warsh at Duquesne before becoming Fed Chair in 2026.

The informal-information channel has repeatedly produced scandals:
- the 2012 Medley Global Advisors leak, which led to Richmond Fed President Lacker's 2017 resignation;
- the 2013–14 lock-up trading evidence;
- the 2021 Fed officials' trading scandal, which prompted the Fed's February 2022 ethics overhaul.

### Cited Findings

**Former officials hired by funds**
- **Ben Bernanke** became a senior adviser to **Citadel** in April 2015, advising investment committees and meeting investors. He said he chose Citadel partly because it is not regulated by the Fed and turned down banks to avoid apparent conflicts. He took an annual fee with no ownership stake or performance pay. — [Christian Science Monitor, 16 Apr 2015](https://csmonitor.com/Business/2015/0416/Ben-Bernanke-gets-a-new-gig); [Financial Advisor magazine](https://www.fa-mag.com/news/ex-fed-chair-bernanke-joins-hedge-fund-citadel-as-advisor-21405.html); [Law360](https://www.law360.com/articles/644161)
- **Jeremy Stein**, former Fed governor, became an adviser to **BlueMountain Capital** on monetary policy, regulation and risk. **Alan Greenspan** joined **Paulson & Co.** as an adviser in 2008. — [CS Monitor](https://csmonitor.com/Business/2015/0416/Ben-Bernanke-gets-a-new-gig); [Finance Magnates](https://www.financemagnates.com/institutional-forex/exchanges/ben-bernanke-assumes-role-of-senior-advisor-at-citadel-investment-group/)
  - *Note:* one search source listed Timothy Geithner joining "the hedge fund Warburg Pincus." Warburg Pincus is a private-equity firm, so that claim is inaccurate as phrased.
- **Brian Sack**, head of the NY Fed Markets Group (2009–2012/13) and co-author of the Gürkaynak–Sack–Swanson papers, joined **D.E. Shaw** in 2013 as Director of Global Economics in its discretionary macro unit (2013–2023). He later moved to **Balyasny** as portfolio manager and head of macro strategy (per Bloomberg via Hedgeweek; start date not confirmed). — [Yale SOM bio PDF](https://som.yale.edu/sites/default/files/2022-09/Brian%20Sack.pdf); [Milken Institute bio](https://milkeninstitute.org/events/gc20/speakers/45807); [Hedgeweek](https://www.hedgeweek.com/de-shaw-md-joins-balyasny-as-pm-and-head-of-macro-strategy/)
- **Simon Potter**, NY Fed markets head until mid-2019, was hired by **Millennium Management** in 2020 as vice chairman, fixed income, to advise its debt portfolio managers. — [Bloomberg, 6 Aug 2020](https://www.bloomberg.com/news/articles/2020-08-06/millennium-said-to-hire-ex-new-york-fed-official-simon-potter)
- **Kevin Warsh**, a Fed governor from 2006 to 2011, became a partner at **Stanley Druckenmiller's Duquesne Family Office** around 2011 and stayed until his nomination as Fed Chair. Forbes Italia (April 2026) reported that his two largest disclosed assets are "Juggernaut Fund, LP" vehicles linked to Duquesne, each valued above $50 million. He was sworn in as Fed Chair on **22 May 2026** after a 54–45 Senate vote, the narrowest ever for a Fed chair per Bloomberg. — [Georgetown McDonough profile](https://msb.georgetown.edu/profiles/kevin-warsh/); [Forbes Italia, 23 Apr 2026](https://forbes.it/2026/04/23/quanto-e-ricco-kevin-warsh-il-presidente-designato-della-federal-reserve); [Bloomberg Law, May 2026](https://news.bloomberglaw.com/banking-law/trump-to-swear-in-warsh-as-fed-chair-on-friday-white-house-says); [ABA Banking Journal, May 2026](https://bankingjournal.aba.com/2026/05/warsh-sworn-in-as-federal-reserve-chair/)

**Sell-side and vendor tools**
- JPMorgan's ChatGPT-based **Hawk-Dove Score** (April 2023) is a documented example of sell-side NLP sold to buy-side clients (see Section 3). — [BNN Bloomberg](https://www.bnnbloomberg.ca/jpmorgan-s-ai-puts-25-years-of-fed-speeches-into-a-hawk-dove-score-1.1912721)
- In **September 2022** (during the pre-meeting period), a WSJ report that the Fed "appears to be on a path" to another 75 bp hike was followed by Goldman Sachs raising its Fed forecast. This is an example of sell-side forecasts reacting to journalist-channel signals. — [investingLive, 7 Sep 2022](https://investinglive.com/centralbank/fed-appears-to-be-on-a-path-to-hike-75-bps-wsj-20220907/); [Investing.com](https://investing.com/news/stock-market-news/goldman-raises-fed-forecast-after-wsj-hint-of-another-75-bps-rate-hike-this-month-432SI-2888241)

**Controversies**
- **Medley Global Advisors leak (2012) and Lacker resignation (2017).** Medley, a policy-intelligence firm serving hedge funds, published a newsletter in **October 2012** revealing details of the September 2012 FOMC deliberations (the QE3 discussion) **one day before the minutes**. Richmond Fed President Jeffrey Lacker resigned immediately in **April 2017**, admitting he had spoken to the analyst and failed to decline comment. He had also given an incomplete account to the Fed's general counsel in 2012. DOJ and FBI joined the inquiry in 2015, and his lawyer said no charges would be filed. — [Housingwire, 4 Apr 2017](https://www.housingwire.com/articles/39766-richmond-fed-president-jeffrey-lacker-resigns-admits-to-leaking-confidential-information/); [National Mortgage News](https://www.nationalmortgagenews.com/news/feds-lacker-resigns-immediately-after-disclosure-of-confidential-information); [SCMP](https://amp.scmp.com/business/global-economy/article/2084865/fed-official-quits-early-after-taking-blame-leak-2012)
- **Lock-up informed trading (2013–14).** See Bernile, Hu & Tang above; the Fed tightened lock-up procedures. — [Financial Advisor](https://www.fa-mag.com/news/investors-may-have-gained-early-word-on-fed-policy-17953.html)
- **Fed officials' trading scandal (2021).**
  - Dallas Fed President **Robert Kaplan** and Boston Fed President **Eric Rosengren** resigned in **September 2021** after disclosures of active trading in 2020.
  - A **July 2022** Inspector General report found no evidence that Chair Powell or Vice Chair **Richard Clarida** broke rules, though Clarida had omitted four trades from disclosures and later amended them.
  - A **January 2024** IG report found Kaplan's and Rosengren's trading created an *appearance* of conflicts of interest but did not allege illegality.
  - The Fed adopted a tightened ethics and investment policy in **February 2022**. Critics such as Better Markets called the 2022 IG report "not credible."

  — [CNBC, 22 Jan 2024](https://www.cnbc.com/2024/01/22/watchdog-report-is-critical-of-former-fed-officials-in-stock-trading-controversy.html); [Kitco, 22 Jan 2024](https://www.kitco.com/news/article/2024-01-22/report-flags-conflict-interest-appearance-ex-fed-bank-presidents-trading); [AP via The Daily Record, 14 Jul 2022](https://thedailyrecord.com/2022/07/14/fed-ethics-inquiry-clears-powell-and-clarida-trades/); [Banking Dive](https://bankingdive.com/news/fed-financial-disclosure-omits-kaplan-rosengren-ethics-stock-trading-scandal/626124)
- **Prediction-market insider risk.** Coverage of the Kalshi research flags insider-trading concerns in event markets. The cited example, a ~$400k profit on a January 2026 Maduro-related bet, is not Fed-related. — [Fortune, 28 Jan 2026](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/)

### Inferences
- The revolving door supplies funds with a *model of how the committee thinks*: how staff memos frame choices, how the Chair builds consensus, what the Desk can do operationally. It does not legitimately supply inside information, since blackout and confidentiality rules apply. The Medley case and Cieslak–Morse–Vissing-Jorgensen show that line has been blurry in practice.
- The 2026 appointment of a Fed Chair who came directly from a macro family office (Warsh/Duquesne) reverses the usual direction of the revolving door. It will likely draw ongoing scrutiny of conflicts; a direct source on current recusal arrangements was not found.
- Sack's career, from academic co-author of the key futures-expectations papers (GSS 2005, 2007) to Fed markets chief to hedge-fund macro PM, illustrates how academic, central bank and buy-side expertise overlap.

### Gaps
- **Could not verify** specific hires of former Fed, ECB or BoE officials at **Brevan Howard, Bridgewater or Rokos** in this session; searches returned nothing reliable. Treat any such claims as unverified.
- Did not verify Bernanke's parallel 2015 PIMCO adviser role or Clarida's 2022 return to PIMCO; both are from background knowledge.
- No reliable data were found on how much funds pay for "Fed watcher" consultancies or on the size of the policy-intelligence industry.

---

## 6. How accurate are these methods, and when do they fail?

### Takeaway
At the **one-day horizon before scheduled meetings**, market pricing and prediction markets are very accurate. Kalshi had a perfect modal record over 2022 to mid-2025, and fed funds futures missed essentially only the September 2024 50 bp cut. Accuracy falls sharply at horizons of several months to a year: SEP dots match year-end outcomes only about a third of the time, and markets systematically underestimate cuts in downturns.

The biggest failures cluster in a few situations:
- **unscheduled or regime-change decisions:** SNB 2015, BoJ December 2022, Fed March 2020;
- **step-size ambiguity:** 50 versus 25 bp in September 2024, 75 bp in June 2022;
- **communication-regime shifts:** the Warsh Fed scrapping forward guidance in June 2026 and reviewing the dot plot;
- **data blackouts:** the October 2025 shutdown.

### Cited Findings

**Short horizon: very accurate**
- Kalshi's median and mode had a perfect day-before FOMC record over the study period, a statistically significant improvement over fed funds futures. The **only miss for other forecasters was September 2024's 50 bp cut**. — [FEDS 2026-010](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm); [Fortune](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/)
- LLM multi-agent simulation reports **91% hike/hold/cut accuracy and 8.3 bp MAE over 218 meetings** (2026 version, not peer reviewed). — [Stanford Digital Economy Lab](https://digitaleconomy.stanford.edu/publication/fomc-in-silico-a-multi-agent-system-for-monetary-policy-decision-modeling)

**Longer horizons: much weaker**
- SEP dots beat surveys and VARs at many horizons, but anchoring slows updating. — [Engstrom, FEDS 2026-026](https://www.federalreserve.gov/econres/feds/anchored-to-the-dot-plot-central-bank-projections-and-interest-rate-expectations.htm)
- The median dot matched the actual year-end rate about **36%** of the time for the current year and about **10%** for the next year (June SEPs, ten years). — [CIBC](https://woodgundyadvisors.cibc.com/documents/506868/506932/Ditch+the+dots.pdf/21ec8ab0-97a0-4d15-928b-a0c868f9a630)
- Apollo argues that both Fed and market forecasts of the funds path are "almost always wrong" but point the same way. — [Apollo Academy](https://www.apolloacademy.com/the-forecasting-record-of-the-fed-and-the-market/)
- Markets **systematically underestimate the depth of easing cycles**, because rare large negative shocks are hard to learn about. — [Schmeling, Schrimpf & Steffensen, JFE 2022](https://www.bis.org/publ/work996.pdf)
- FOMC projection errors are large. — [Reifschneider & Tulip, FEDS 2017-020](https://doi.org/10.17016/FEDS.2017.020)

**Classic failure cases**
- **SNB, 15 Jan 2015.** Days after calling the 1.20 CHF/EUR floor the "cornerstone" of policy, the SNB scrapped it and cut the deposit rate to −0.75%. The franc jumped nearly 30% against the euro in early trading, and CHF trading was briefly disrupted. The SNB did not forewarn peers; IMF chief Lagarde said she was surprised she was not contacted. — [Reuters footage record](https://reuters.screenocean.com/record/567148); [City A.M.](https://www.cityam.com/swiss-national-bank-shock-what-does-it-all-mean/); [Business Standard/Reuters](https://www.business-standard.com/amp/article/reuters/snb-leaves-policy-vacuum-after-shock-removal-of-franc-cap-115011700055_1.html)
- **BoJ, 20 Dec 2022.** The BoJ widened its 10-year JGB yield band from ±0.25% to ±0.50% while most analysts expected no change before Governor Kuroda's April 2023 departure. The 10-year yield jumped from about 0.25% to about 0.45%, the yen rose nearly 4% against the dollar and global yields rose. Kuroda insisted it was "definitely not a step towards an exit." — [FocusEconomics](https://www.focus-economics.com/countries/japan/news/monetary-policy/boj-unexpectedly-changes-yield-curve-control-policy-sending-shockwaves-through-financial-markets/); [ING Think](https://think.ing.com/downloads/pdf/snap/bank-of-japan-surprise-surprise-surprise); [S&P Global](https://www.spglobal.com/market-intelligence/en/news-insights/articles/2022/12/japan-central-bank-s-unexpected-policy-change-offers-little-succor-to-lenders-73573559)
- **Fed, June 2022.** Pricing for 75 bp jumped only after the WSJ report two days before the meeting, showing reliance on informal signals when data shift during the blackout. — [investingLive](https://investinglive.com/centralbank/wsj-fedwatcher-speculates-about-a-75-basis-point-hike-20220613/)

**Current regime context (as of October 2026)**
- **Kevin Warsh** has been Fed Chair since **22 May 2026**. — [ABA Banking Journal](https://bankingjournal.aba.com/2026/05/warsh-sworn-in-as-federal-reserve-chair/)
- **June 2026 FOMC**, his first, held rates and changed communication:
  - The committee unanimously cut the statement to three paragraphs and **removed all forward guidance**.
  - Warsh did not submit a dot and described the dots as made with "pencils with big erasers."
  - He launched **five task forces** on communications, the balance sheet, data sources, productivity/jobs and the inflation framework. Reportedly the dot plot, SEP, minutes, transcripts and even the press conferences are under review.
  - The June SEP had 9 participants projecting a hike in 2026, 8 no change and 1 a cut, with a median of 3.8% for end-2026.

  — [J.P. Morgan, June 2026 FOMC takeaways](https://www.jpmorgan.com/insights/markets-and-economy/economy/kevin-warsh-june-2026-federal-reserve-meeting-key-takeaways); [Enterprise AM, 18 Jun 2026](https://enterpriseam.com/ksa/2026/06/18/kevin-warsh-kicks-off-era-as-fed-chief-with-a-rate-hold-and-a-makeover/); [Phillip Securities (POEMS)](https://www.poems.com.sg/bonds/article/warsh-fed-opens-a-new-chapter/)
- **16 September 2026 FOMC.** The Committee **raised** the target range by 25 bp to **3¾–4%**, by a **12–0** vote: "Inflation remains elevated. Today's policy action will support a timelier return to the Committee's 2 percent goal." — [Federal Reserve press release, 16 Sep 2026](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm)
  - Secondary sources say the hike was the market base case and that the prior range was 3.50–3.75% (since December 2025). — [FedRateCalc](https://fedratecalc.com/fomc-meeting-schedule/september-2026/); [ATFX preview](https://www.atfx.com/en-au/analysis/financial-events/september-fomc-meeting-2026-is-a-rate-hike-on-the-table) (secondary; not verified against Fed releases)
- **Fed prediction-market interest.** A Warsh-era Fed paper explicitly endorses prediction markets as a policy-relevant benchmark. — [iGaming Business](https://igamingbusiness.com/finance/federal-reserve-prediction-markets-paper-warsh/); [FEDS 2026-010](https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm)

### Inferences
- **Where methods fail is predictable.** Market-implied probabilities are excellent when the central bank pre-signals, as the Powell-era Fed did through guidance, dots and leaks to journalists. They are weakest when the bank deliberately withholds guidance, changes its framework, or acts on financial-stability or currency grounds (SNB 2015, BoJ 2022).
- **The Warsh-era shift raises the value of independent modelling.** Removing forward guidance, possibly dropping the dot plot and holding fewer press conferences push forecasting back toward reaction-function modelling, data nowcasting and member-level text analysis. The September 2026 hike was apparently well priced despite the absence of guidance (secondary sources), but a September FOMC sample of one cannot establish whether accuracy has fallen. Engstrom (2026) implies a trade-off: no dots means less anchoring bias but also less average accuracy.
- **Step-size errors are the residual risk.** Direction is usually priced correctly; 50 versus 25 bp (Sept 2024) and 75 versus 50 bp (June 2022) are where professionals still disagree. That is where distributional tools (options, Kalshi ladders) beat FedWatch's mean-based two-outcome tree.
- **Easing cycles are systematically under-priced** (Schmeling et al.; Piazzesi–Swanson's countercyclical returns). The consistent historical edge has been to bet on deeper and faster cuts once a downturn starts, a key reason "receive rates in recessions" is a staple macro trade.

### Gaps
- BoJ January 2016 negative-rate surprise: no source retrieved this session.
- Fed March 2020 emergency cuts and the RBA's November 2021 abandonment of yield-curve control were not sourced this session.
- No systematic comparative accuracy statistics were found for ECB, BoE or BoJ market-implied probabilities, comparable to the Kalshi/FEDS study for the Fed.
- The outcomes of the Warsh task forces (dot plot, SEP, press conferences) were not yet known in the sources found. Check for an October/November 2026 announcement.
- Kalshi study sample end date conflicts between sources (June 2024 vs June 2025); check the paper.
