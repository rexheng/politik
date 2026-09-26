export interface CatalogDoc {
  title: string;
  kind: string;
  jurisdiction: string;
  sourceId: string;
  published: string;
  url: string;
  fetched: string;
  sha256: string;
  redistributionOk: boolean;
  attribution: string;
}

export interface CatalogSource {
  id: string;
  documents: number;
  redistributionOk: boolean;
  attribution: string;
}

export interface CatalogJurisdiction {
  id: string;
  label: string;
  documents: number;
}

export interface BlockedSource {
  id: string;
  jurisdiction: string;
  live: boolean;
  ended: string;
  error: string;
  url: string;
  attribution: string;
  officialText: false;
}

export interface Catalog {
  blocked: BlockedSource[];
  jurisdictions: CatalogJurisdiction[];
  sources: CatalogSource[];
  latest: CatalogDoc[];
}

const CA_ATTRIBUTION = "California Department of Justice, Office of the Attorney General";

const LATEST: CatalogDoc[] = [
  {
    title:
      "Ahead of Anniversary of Critical Disability Rights Legislation, Attorney General Bonta Reaffirms California\u2019s Commitment to Uplifting and Defending the Rights of Californians with Disabilities",
    published: "2026-09-25T17:16:18+00:00",
    url: "https://oag.ca.gov/news/press-releases/ahead-anniversary-critical-disability-rights-legislation-attorney-general-bonta",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "fb99d517ca9d\u2026",
  },
  {
    title:
      "Attorney General Bonta Rebukes Trump Administration Attempt to Politicize and Undermine Education Grant Funding",
    published: "2026-09-25T15:02:59+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-rebukes-trump-administration-attempt-politicize-and",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "5ed4c04f0b47\u2026",
  },
  {
    title:
      "Attorney General Bonta Opposes Another Attempt by Trump Administration to Impose Unlawful Taxes on H-1B Visas",
    published: "2026-09-24T17:27:18+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-opposes-another-attempt-trump-administration-impose",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "e0715c299798\u2026",
  },
  {
    title:
      "Attorney General Bonta Secures Major Victories from State\u2019s Highest Court, Confirming Authority to Issue Binding Directives to Riverside Sheriff and Ordering Sheriff to Return Voted Ballots to the Registrar of Voters",
    published: "2026-09-24T16:17:06+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-secures-major-victories-state%E2%80%99s-highest-court-confirming",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "eebc4b01451b\u2026",
  },
  {
    title:
      "Attorney General Bonta: Congress Must Act Urgently to Protect Against Catastrophic AI Threats",
    published: "2026-09-24T15:37:54+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-congress-must-act-urgently-protect-against-catastrophic",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "a38e71a2ac98\u2026",
  },
  {
    title:
      "Attorney General Bonta Urges Consumers to Claim Compensation for Inflated Generic Drug Prices",
    published: "2026-09-24T14:04:08+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-urges-consumers-claim-compensation-inflated-generic-drug",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "d284fc47b05c\u2026",
  },
  {
    title:
      "Attorney General Bonta Disputes Another Trump Administration Proposal That Would Harm Our National Forests",
    published: "2026-09-23T20:23:18+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-disputes-another-trump-administration-proposal-would-harm",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "12bdb0e12a79\u2026",
  },
  {
    title:
      "Attorney General Bonta Calls on Trump Administration to Stop Undermining Federal Vaccine Guidance",
    published: "2026-09-22T17:24:45+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-calls-trump-administration-stop-undermining-federal",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "40a1ee84dbb3\u2026",
  },
  {
    title:
      "Attorney General Bonta Opposes Trump Administration Proposed Rule That Would Unlawfully Disrupt How Medicaid Is Currently Funded, Shift More Costs to States",
    published: "2026-09-22T16:11:48+00:00",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-opposes-trump-administration-proposed-rule-would",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "7ea9739de384\u2026",
  },
  {
    title:
      "During Climate Week, Attorney General Bonta Announces Second Lawsuit Challenging Unlawful Trump Administration Offshore Wind Deal",
    published: "2026-09-21T21:02:02+00:00",
    url: "https://oag.ca.gov/news/press-releases/during-climate-week-attorney-general-bonta-announces-second-lawsuit-challenging",
    fetched: "2026-09-25T22:01:01+00:00",
    sha256: "eb470b1069b8\u2026",
  },
].map((doc) => ({
  ...doc,
  kind: "news",
  jurisdiction: "US-CA",
  sourceId: "ca-ag-rss",
  redistributionOk: true,
  attribution: CA_ATTRIBUTION,
}));

const CATALOG: Catalog = {
  blocked: [
    {
      id: "sso-new-legislation",
      jurisdiction: "SG",
      live: true,
      ended: "2026-09-26T00:01:07+00:00",
      error: "HTTP 403 from https://sso.agc.gov.sg/What's-New/New-Legislation/RSS",
      url: "https://sso.agc.gov.sg",
      attribution: "Singapore Statutes Online, Attorney-General\u2019s Chambers",
      officialText: false,
    },
  ],
  jurisdictions: [
    { id: "SG", label: "SG", documents: 3485 },
    { id: "US-CA", label: "US-CA", documents: 10 },
  ],
  sources: [
    {
      id: "ca-ag-rss",
      documents: 10,
      redistributionOk: true,
      attribution: CA_ATTRIBUTION,
    },
    {
      id: "gebiz",
      documents: 3485,
      redistributionOk: true,
      attribution:
        "Contains information from data.gov.sg (GeBIZ Government Procurement) made available under the Singapore Open Data Licence",
    },
  ],
  latest: LATEST,
};

export function loadCatalog(): Catalog {
  return CATALOG;
}
