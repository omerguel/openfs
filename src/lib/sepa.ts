/* ------------------------------------------------------------------ */
/* SEPA helpers — pure functions shared by server and client:          */
/* IBAN / Gläubiger-ID validation (ISO 7064 mod 97-10), the SEPA       */
/* character set, and the pain.008.001.02 (SEPA-Basislastschrift,      */
/* CORE) XML the bank portal imports.                                  */
/* ------------------------------------------------------------------ */

/** Upper-case, no spaces. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** "DE89370400440532013000" → "DE89 3704 0044 0532 0130 00" */
export function formatIban(value: string): string {
  return normalizeIban(value)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/* ISO 7064 mod 97-10 over a string of digits and letters (A=10 … Z=35),
   computed piecewise so it never exceeds Number precision. */
function mod97(input: string): number {
  let remainder = 0;
  for (const char of input) {
    const code = char.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : char;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

const IBAN_LENGTHS: Record<string, number> = {
  DE: 22,
  AT: 20,
  CH: 21,
  LI: 21,
  NL: 18,
  BE: 16,
  LU: 20,
  FR: 27,
  IT: 27,
  ES: 24,
  PL: 28,
  DK: 18,
  CZ: 24,
};

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

export function isValidBic(value: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.trim().toUpperCase());
}

/* Gläubiger-ID: CC + 2 check digits + 3-char business code (ignored for
   the checksum) + national identifier, e.g. DE98ZZZ09999999999. */
export function isValidCreditorId(value: string): boolean {
  const id = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id)) return false;
  if (id.startsWith("DE") && id.length !== 18) return false;
  return mod97(id.slice(7) + id.slice(0, 4)) === 1;
}

/* SEPA Latin subset: a-z A-Z 0-9 / - ? : ( ) . , ' + space. German
   umlauts are transliterated, anything else becomes a space. */
export function toSepaText(value: string, maxLength: number): string {
  const replaced = value
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return replaced.slice(0, maxLength).trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatSepaAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type SepaSequenceType = "FRST" | "RCUR";

export type Pain008Transaction = {
  endToEndId: string;
  amountCents: number;
  mandateRef: string;
  mandateSignedOn: string; // YYYY-MM-DD
  debtorName: string;
  debtorIban: string;
  debtorBic?: string;
  remittance: string;
  sequenceType: SepaSequenceType;
};

export type Pain008Input = {
  msgId: string;
  createdAt: string; // ISO date-time, e.g. 2026-06-10T09:30:00
  collectionDate: string; // YYYY-MM-DD
  creditor: { name: string; iban: string; bic?: string; creditorId: string };
  transactions: Pain008Transaction[];
};

function agent(bic: string | undefined): string {
  const clean = (bic ?? "").trim().toUpperCase();
  return clean
    ? `<FinInstnId><BIC>${escapeXml(clean)}</BIC></FinInstnId>`
    : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>";
}

/** pain.008.001.02 — one PmtInf block per sequence type (FRST / RCUR). */
export function buildPain008(input: Pain008Input): string {
  const sum = (list: Pain008Transaction[]) =>
    formatSepaAmount(list.reduce((total, tx) => total + tx.amountCents, 0));
  const creditorName = escapeXml(toSepaText(input.creditor.name, 70));
  const groups = (["FRST", "RCUR"] as const)
    .map((seq) => ({
      seq,
      list: input.transactions.filter((tx) => tx.sequenceType === seq),
    }))
    .filter((group) => group.list.length > 0);

  const paymentInfos = groups
    .map(({ seq, list }) => {
      const txs = list
        .map(
          (tx) => `
      <DrctDbtTxInf>
        <PmtId><EndToEndId>${escapeXml(tx.endToEndId)}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${formatSepaAmount(tx.amountCents)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${escapeXml(toSepaText(tx.mandateRef, 35))}</MndtId>
            <DtOfSgntr>${tx.mandateSignedOn}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>${agent(tx.debtorBic)}</DbtrAgt>
        <Dbtr><Nm>${escapeXml(toSepaText(tx.debtorName, 70))}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${normalizeIban(tx.debtorIban)}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${escapeXml(toSepaText(tx.remittance, 140))}</Ustrd></RmtInf>
      </DrctDbtTxInf>`,
        )
        .join("");
      return `
    <PmtInf>
      <PmtInfId>${escapeXml(`${input.msgId}-${seq}`.slice(0, 35))}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${list.length}</NbOfTxs>
      <CtrlSum>${sum(list)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Cd>CORE</Cd></LclInstrm>
        <SeqTp>${seq}</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${input.collectionDate}</ReqdColltnDt>
      <Cdtr><Nm>${creditorName}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${normalizeIban(input.creditor.iban)}</IBAN></Id></CdtrAcct>
      <CdtrAgt>${agent(input.creditor.bic)}</CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id><PrvtId><Othr>
          <Id>${escapeXml(input.creditor.creditorId.replace(/\s+/g, "").toUpperCase())}</Id>
          <SchmeNm><Prtry>SEPA</Prtry></SchmeNm>
        </Othr></PrvtId></Id>
      </CdtrSchmeId>${txs}
    </PmtInf>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${escapeXml(input.msgId)}</MsgId>
      <CreDtTm>${input.createdAt}</CreDtTm>
      <NbOfTxs>${input.transactions.length}</NbOfTxs>
      <CtrlSum>${sum(input.transactions)}</CtrlSum>
      <InitgPty><Nm>${creditorName}</Nm></InitgPty>
    </GrpHdr>${paymentInfos}
  </CstmrDrctDbtInitn>
</Document>
`;
}
