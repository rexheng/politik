// Who published a source document, how to credit them, and whether the text may be redistributed.
// The table is keyed by host, so it only covers the hosts the candidate list links to; any other host falls back to
// the issuer the model found in the text.
// Node-only build code: never import this from photon/src.

export type Publisher = { publisher: string; attribution: string; redistributionOk: boolean };

const NOT_REDISTRIBUTABLE = false;
const REDISTRIBUTABLE = true;

const SODL =
  "Contains information from datasets accessed from data.gov.sg, made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).";

/** `redistributionOk` is true only for California government works and for data.gov.sg (Singapore Open Data Licence). */
const BY_HOST: Record<string, Publisher> = {
  // California
  "leginfo.legislature.ca.gov": {
    publisher: "California Legislative Information",
    attribution: "California Legislative Information (leginfo.legislature.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "oag.ca.gov": {
    publisher: "California Department of Justice, Office of the Attorney General",
    attribution: "California Department of Justice, Office of the Attorney General (oag.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "gov.ca.gov": {
    publisher: "Office of the Governor of California",
    attribution: "Office of the Governor of California (gov.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "cppa.ca.gov": {
    publisher: "California Privacy Protection Agency",
    attribution: "California Privacy Protection Agency (cppa.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "cdt.ca.gov": {
    publisher: "California Department of Technology",
    attribution: "California Department of Technology (cdt.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "cpuc.ca.gov": {
    publisher: "California Public Utilities Commission",
    attribution: "California Public Utilities Commission (cpuc.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "publicadvocates.cpuc.ca.gov": {
    publisher: "Public Advocates Office, California Public Utilities Commission",
    attribution: "Public Advocates Office, California Public Utilities Commission (publicadvocates.cpuc.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "energy.ca.gov": {
    publisher: "California Energy Commission",
    attribution: "California Energy Commission (energy.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "calcivilrights.ca.gov": {
    publisher: "California Civil Rights Department",
    attribution: "California Civil Rights Department (calcivilrights.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },
  "govops.ca.gov": {
    publisher: "California Government Operations Agency",
    attribution: "California Government Operations Agency (govops.ca.gov), State of California.",
    redistributionOk: REDISTRIBUTABLE,
  },

  // Singapore
  "sso.agc.gov.sg": {
    publisher: "Singapore Statutes Online, Attorney-General's Chambers",
    attribution: "Singapore Statutes Online (sso.agc.gov.sg), Attorney-General's Chambers of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "imda.gov.sg": {
    publisher: "Infocomm Media Development Authority",
    attribution: "Infocomm Media Development Authority (imda.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "pdpc.gov.sg": {
    publisher: "Personal Data Protection Commission",
    attribution: "Personal Data Protection Commission (pdpc.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "mddi.gov.sg": {
    publisher: "Ministry of Digital Development and Information",
    attribution: "Ministry of Digital Development and Information (mddi.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "csa.gov.sg": {
    publisher: "Cyber Security Agency of Singapore",
    attribution: "Cyber Security Agency of Singapore (csa.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "mha.gov.sg": {
    publisher: "Ministry of Home Affairs",
    attribution: "Ministry of Home Affairs (mha.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "mas.gov.sg": {
    publisher: "Monetary Authority of Singapore",
    attribution: "Monetary Authority of Singapore (mas.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "edb.gov.sg": {
    publisher: "Singapore Economic Development Board",
    attribution: "Singapore Economic Development Board (edb.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "police.gov.sg": {
    publisher: "Singapore Police Force",
    attribution: "Singapore Police Force (police.gov.sg), Government of Singapore.",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "sprs.parl.gov.sg": {
    publisher: "Parliament of Singapore",
    attribution: "Parliament of Singapore, Singapore Parliament Reports (sprs.parl.gov.sg).",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "aiverifyfoundation.sg": {
    publisher: "AI Verify Foundation",
    attribution: "AI Verify Foundation (aiverifyfoundation.sg).",
    redistributionOk: NOT_REDISTRIBUTABLE,
  },
  "data.gov.sg": {
    publisher: "data.gov.sg, Government of Singapore",
    attribution: SODL,
    redistributionOk: REDISTRIBUTABLE,
  },
};

/** The table row for the longest known host that `host` is or is a subdomain of (docs.cpuc.ca.gov is the CPUC). */
function lookup(host: string): Publisher | undefined {
  const labels = host.replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length; i++) {
    const row = BY_HOST[labels.slice(i).join(".")];
    if (row) return row;
  }
  return undefined;
}

/**
 * The publisher, attribution line and redistribution flag for a source URL.
 * A "www." prefix and any subdomain of a known host count as that host. An unknown host (or a string that is not a URL)
 * gets the issuer as publisher and attribution, and is not redistributable: nothing is assumed about its terms.
 */
export function publisherFor(url: string, issuer: string): Publisher {
  try {
    const known = lookup(new URL(url).hostname.toLowerCase());
    if (known) return { ...known };
  } catch {
    /* not a URL: fall through to the fallback */
  }
  return { publisher: issuer, attribution: issuer, redistributionOk: false };
}
