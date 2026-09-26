import type { TaggedItem, Category } from "./contracts.ts";

export function loadBriefings(): TaggedItem[] {
  const items: Array<Omit<TaggedItem, "category"> & { category: Category }> = [
    {
      id: "briefing-bill-vote",
      source: "briefing",
      title: "AI transparency bill waits on House vote",
      plain:
        "A bill requiring clearer labels on AI-generated content cleared committee months ago. Leadership has not scheduled a floor vote.",
      url: "https://www.congress.gov/",
      happenedAt: "2026-03-12T14:00:00.000Z",
      category: "bill-stuck",
      tags: ["congress", "ai", "transparency", "house"],
    },
    {
      id: "briefing-data-center-town",
      source: "briefing",
      title: "Town hall clash over proposed data center",
      plain:
        "Residents in a Midwestern town are split over a large data center plan. Some want the jobs and tax base; others worry about water use and noise.",
      happenedAt: "2026-02-18T19:30:00.000Z",
      category: "local-worry",
      tags: ["data-center", "local", "water", "jobs"],
    },
    {
      id: "briefing-lab-chip-round",
      source: "briefing",
      title: "Chip startup raises large Series B",
      plain:
        "A semiconductor design lab closed a big funding round to build faster AI chips. The money will expand its U.S. engineering team.",
      happenedAt: "2026-01-22T16:00:00.000Z",
      category: "lab-money",
      tags: ["funding", "chips", "startup"],
    },
    {
      id: "briefing-openalex-safety",
      source: "briefing",
      title: "New study on AI model safety testing",
      plain:
        "Researchers published a paper comparing how labs test models before release. They found big gaps in how teams check for harmful outputs.",
      happenedAt: "2026-04-03T10:15:00.000Z",
      category: "research",
      tags: ["safety", "models", "paper"],
    },
    {
      id: "briefing-nist-speech",
      source: "briefing",
      title: "Commerce official outlines AI standards push",
      plain:
        "A senior Commerce Department speaker said the agency will keep updating voluntary AI safety guidelines. The talk stressed working with industry and universities.",
      happenedAt: "2026-05-08T17:45:00.000Z",
      category: "speech",
      tags: ["commerce", "standards", "guidelines"],
    },
    {
      id: "briefing-bill-senate-hold",
      source: "briefing",
      title: "Senate AI workforce bill stalled in committee",
      plain:
        "A bipartisan bill to fund AI job training is stuck after markup. Sponsors say they still lack agreement on who gets the grants.",
      happenedAt: "2026-06-11T13:20:00.000Z",
      category: "bill-stuck",
      tags: ["senate", "workforce", "training"],
    },
    {
      id: "briefing-school-ai-policy",
      source: "briefing",
      title: "Parents push school board on classroom AI tools",
      plain:
        "A suburban school board heard hours of comment on whether students may use AI for homework. Parents asked for a clear written policy before fall.",
      happenedAt: "2026-08-14T23:00:00.000Z",
      category: "local-worry",
      tags: ["schools", "parents", "policy"],
    },
    {
      id: "briefing-lab-cloud-deal",
      source: "briefing",
      title: "AI lab signs multi-year cloud compute deal",
      plain:
        "A major AI lab locked in a long cloud contract to train larger models. The deal is one of the biggest compute buys reported this year.",
      happenedAt: "2026-09-02T15:30:00.000Z",
      category: "lab-money",
      tags: ["cloud", "compute", "deal"],
    },
  ];

  return items;
}
