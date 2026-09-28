/* ------------------------------------------------------------------ */
/* Impressum — /impressum                                              */
/* Public, outside the staff app shell. Rendered from the company     */
/* profile (Profil → Stammdaten); missing fields show a notice and a   */
/* visible placeholder — nothing is invented.                          */
/* ------------------------------------------------------------------ */

import { missingImpressumFields, type LegalInfo } from "@/lib/legal";
import {
  Address,
  LegalPage,
  LegalSection,
  MissingFieldsNotice,
  Value,
} from "@/components/legal/LegalPage";

function ImpressumContent({ info }: { info: LegalInfo }) {
  const hasRegister = Boolean(info.registergericht || info.registernummer);
  const hasTaxIds = Boolean(info.ustIdNr || info.steuernummer);
  return (
    <div className="space-y-8">
      <MissingFieldsNotice fields={missingImpressumFields(info)} />

      <LegalSection title="Angaben gemäß § 5 DDG">
        <p>
          <span className="block font-medium">
            <Value value={info.name} label="Name der Fahrschule" />
          </span>
          <span className="block">
            Inhaber:in bzw. vertretungsberechtigt:{" "}
            <Value value={info.inhaber} label="Inhaber:in" />
          </span>
          <Address address={info.address} />
        </p>
      </LegalSection>

      <LegalSection title="Kontakt">
        <p>
          <span className="block tabular-nums">
            Telefon: <Value value={info.phone} label="Telefon" />
          </span>
          <span className="block">
            E-Mail:{" "}
            {info.email ? (
              <a href={`mailto:${info.email}`} className="text-primary hover:underline">
                {info.email}
              </a>
            ) : (
              <Value value="" label="E-Mail" />
            )}
          </span>
          {info.website && <span className="block">Webseite: {info.website}</span>}
        </p>
      </LegalSection>

      {hasRegister && (
        <LegalSection title="Registereintrag">
          <p>
            <span className="block">
              Registergericht:{" "}
              <Value value={info.registergericht} label="Registergericht" />
            </span>
            <span className="block">
              Registernummer:{" "}
              <span className="font-mono text-[13px]">
                <Value value={info.registernummer} label="Registernummer" />
              </span>
            </span>
          </p>
        </LegalSection>
      )}

      {hasTaxIds && (
        <LegalSection title="Umsatzsteuer-ID">
          {info.ustIdNr && (
            <p>
              Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:{" "}
              <span className="font-mono text-[13px]">{info.ustIdNr}</span>
            </p>
          )}
          {info.steuernummer && (
            <p>
              Steuernummer:{" "}
              <span className="font-mono text-[13px]">{info.steuernummer}</span>
            </p>
          )}
        </LegalSection>
      )}

      <LegalSection title="Aufsichtsbehörde">
        <p>
          Die Fahrschule wird mit einer Fahrschulerlaubnis nach dem Fahrlehrergesetz
          (FahrlG) betrieben. Zuständige Aufsichtsbehörde:{" "}
          <Value value={info.aufsichtsbehoerde} label="Aufsichtsbehörde" />
        </p>
        <p>
          Maßgebliche berufsrechtliche Regelungen: Fahrlehrergesetz (FahrlG) und
          Fahrschüler-Ausbildungsordnung (FahrSchAusbO), abrufbar unter
          www.gesetze-im-internet.de.
        </p>
      </LegalSection>

      <LegalSection title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>
          <span className="block">
            <Value value={info.inhaber} label="Inhaber:in" />
          </span>
          <Address address={info.address} />
        </p>
      </LegalSection>

      {info.impressumZusatz && (
        <LegalSection title="Weitere Angaben">
          <p className="whitespace-pre-line">{info.impressumZusatz}</p>
        </LegalSection>
      )}
    </div>
  );
}

export function Impressum() {
  return (
    <LegalPage title="Impressum">{(info) => <ImpressumContent info={info} />}</LegalPage>
  );
}

export default Impressum;
