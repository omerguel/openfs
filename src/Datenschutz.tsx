/* ------------------------------------------------------------------ */
/* Datenschutzerklärung — /datenschutz                                 */
/* Public, outside the staff app shell. A clearly marked TEMPLATE that */
/* describes what OpenFS actually processes on its public surfaces     */
/* (/anfrage, Schülerportal, E-Mail-Benachrichtigungen). Values come   */
/* from the company profile; placeholders in [eckigen Klammern] must   */
/* be completed by the school.                                         */
/* ------------------------------------------------------------------ */

import { FileWarning } from "lucide-react";

import {
  missingDatenschutzFields,
  privacyContactEmail,
  type PublicLegalInfo,
} from "@/lib/legal";
import {
  DEFAULT_RETENTION_POLICY,
  formatPeriod,
  type RetentionCategory,
} from "@/lib/retention";
import {
  Address,
  LabeledLine,
  LegalPage,
  LegalSection,
  MissingFieldsNotice,
  StaffOnly,
  Value,
  useIsStaffViewer,
} from "@/components/legal/LegalPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/* [Platzhalter] for the school to fill in — shown to signed-in staff
   only; visitors get the text without them. */
function Placeholder({ children }: { children: string }) {
  if (!useIsStaffViewer()) return null;
  return <span className="text-muted-foreground italic">[{children}]</span>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/* Löschfristen as the retention job applies them (Fahrschule →
   Datenschutz); falls back to the defaults for older servers. */
function periodOf(info: PublicLegalInfo, category: RetentionCategory): string {
  return formatPeriod(
    info.retention?.[category] ?? DEFAULT_RETENTION_POLICY.months[category],
  );
}

function DatenschutzContent({ info }: { info: PublicLegalInfo }) {
  const privacyEmail = privacyContactEmail(info);
  const period = (category: RetentionCategory) => periodOf(info, category);
  return (
    <div className="space-y-8">
      <StaffOnly>
        <Alert>
          <FileWarning />
          <AlertTitle>Vorlage — von der Fahrschule zu prüfen</AlertTitle>
          <AlertDescription>
            Diese Datenschutzerklärung ist eine Vorlage, die beschreibt, welche Daten die
            Software OpenFS auf den öffentlichen Seiten verarbeitet. Die Fahrschule ist
            als Verantwortliche für den Inhalt zuständig und muss sie an ihre tatsächliche
            Verarbeitung anpassen. Angaben in [eckigen Klammern] sind zu ergänzen. Die
            Vorlage ersetzt keine Rechtsberatung. Diesen Hinweis und die Platzhalter sehen
            nur angemeldete Mitarbeitende.
          </AlertDescription>
        </Alert>
      </StaffOnly>

      <MissingFieldsNotice fields={missingDatenschutzFields(info)} />

      <LegalSection title="1. Verantwortliche Stelle">
        <p>Verantwortlich im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:</p>
        <p>
          <span className="block font-medium">
            <Value value={info.name} label="Name der Fahrschule" />
          </span>
          <LabeledLine label="Inhaber/in" value={info.inhaber} />
          <Address address={info.address} />
          {info.phone && (
            <span className="block tabular-nums">Telefon: {info.phone}</span>
          )}
          <LabeledLine label="E-Mail" value={info.email} />
        </p>
        <p>
          {privacyEmail ? (
            <>
              Anfragen zum Datenschutz richten Sie bitte an:{" "}
              <a href={`mailto:${privacyEmail}`} className="text-primary hover:underline">
                {privacyEmail}
              </a>
              .{" "}
            </>
          ) : (
            <StaffOnly>
              Anfragen zum Datenschutz richten Sie bitte an:{" "}
              <Placeholder>E-Mail für Datenschutzanfragen fehlt</Placeholder>.{" "}
            </StaffOnly>
          )}
          <Placeholder>
            Falls ein Datenschutzbeauftragter benannt ist: Name und Kontakt ergänzen
          </Placeholder>
        </p>
      </LegalSection>

      <LegalSection title="2. Bereitstellung der Website und Server-Logfiles">
        <p>
          Beim Aufruf dieser Seiten verarbeitet der Server technisch notwendige Daten, die
          Ihr Browser übermittelt: IP-Adresse, Datum und Uhrzeit des Abrufs, aufgerufene
          Adresse sowie Browser- und Betriebssystemangaben. Die IP-Adresse wird außerdem
          kurzzeitig im Arbeitsspeicher genutzt, um die Zahl der Anfragen pro Absender zu
          begrenzen und Missbrauch abzuwehren; in der Datenbank der Fahrschule wird sie
          dabei nicht gespeichert.
        </p>
        <p>
          Zweck ist die Auslieferung der Seiten und die Sicherheit des Betriebs.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem
          sicheren, funktionsfähigen Angebot).
          <StaffOnly>
            {" "}
            Speicherdauer etwaiger Server-Logfiles beim Hosting-Anbieter:{" "}
            <Placeholder>Speicherdauer ergänzen</Placeholder>.
          </StaffOnly>
        </p>
        <p>
          Die Software wird durch einen Auftragsverarbeiter nach Art. 28 DSGVO betrieben.
          <StaffOnly>
            {" "}
            Betreiber:{" "}
            <Placeholder>Name und Anschrift des Software-Anbieters</Placeholder>; Hosting
            durch <Placeholder>Hosting-Anbieter und Serverstandort ergänzen</Placeholder>.
          </StaffOnly>
        </p>
      </LegalSection>

      <LegalSection title="3. Cookies und Dienste Dritter">
        <p>
          Die öffentlichen Seiten (Terminanfrage, Schülerportal, Impressum,
          Datenschutzerklärung) setzen keine Tracking- oder Analyse-Cookies und binden
          keine Analyse-, Werbe- oder Social-Media-Dienste Dritter ein. Schriftarten
          werden vom eigenen Server geladen.
        </p>
        <p>
          Eingesetzt werden ausschließlich technisch notwendige Cookies, etwa für die
          Anmeldung von Mitarbeitenden der Fahrschule. Diese sind nach § 25 Abs. 2 Nr. 2
          TDDDG ohne Einwilligung zulässig.
        </p>
      </LegalSection>

      <LegalSection title="4. Online-Terminanfrage">
        <p>
          Wenn Sie über das Formular „Terminanfrage“ einen Termin anfragen, verarbeiten
          wir:
        </p>
        <List
          items={[
            "Name (Pflichtangabe)",
            "Telefonnummer und/oder E-Mail-Adresse (mindestens eine Angabe, damit wir Sie erreichen können)",
            "Terminart sowie Wunschdatum und Wunschuhrzeit (Pflichtangaben)",
            "Ihre Nachricht (freiwillig)",
          ]}
        />
        <p>
          Zweck ist die Bearbeitung Ihrer Anfrage und die Vereinbarung eines Termins.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Durchführung vorvertraglicher
          Maßnahmen auf Ihre Anfrage). Wird ein Termin bestätigt oder abgelehnt und haben
          Sie eine E-Mail-Adresse angegeben, erhalten Sie darüber eine E-Mail. Werden Sie
          nicht Fahrschülerin oder Fahrschüler, löschen wir Name, Kontaktdaten und
          Nachricht {period("anfragen")} nach Eingang der Anfrage.
        </p>
      </LegalSection>

      <LegalSection title="5. Schülerportal">
        <p>
          Fahrschülerinnen und Fahrschüler erhalten einen persönlichen Zugangslink zum
          Schülerportal. Dort werden angezeigt bzw. verarbeitet: Name und
          Führerscheinklassen, anstehende und vergangene Termine, der Ausbildungsstand
          (absolvierte Fahrstunden, Sonderfahrten und Theorieunterricht), die Zahl der im
          Ausbildungsnachweis erfassten Stunden, der Kontostand (Guthaben oder offener
          Betrag) und offene Rechnungen, die Namen der bei der Fahrschule hinterlegten
          Dokumente sowie Nachrichten zwischen Ihnen und der Fahrschule.
        </p>
        <p>
          Zweck ist die Durchführung des Ausbildungsvertrags. Rechtsgrundlage ist Art. 6
          Abs. 1 lit. b DSGVO. Der Link wirkt wie ein Passwort — bitte geben Sie ihn nicht
          weiter. Die Fahrschule kann ihn jederzeit sperren und einen neuen ausstellen.
          Mit dem Ende der Ausbildung wird der Link gelöscht.
        </p>
      </LegalSection>

      <LegalSection title="6. Benachrichtigungen per E-Mail">
        <p>
          Sofern eine E-Mail-Adresse hinterlegt ist, versendet die Fahrschule
          Benachrichtigungen im Rahmen der Ausbildung, insbesondere Terminbestätigungen
          und -absagen, Erinnerungen am Vortag eines Termins, den Zugangslink zum
          Schülerportal sowie individuelle Nachrichten. Rechtsgrundlage ist Art. 6 Abs. 1
          lit. b DSGVO.
          <StaffOnly>
            {" "}
            Versand über: <Placeholder>E-Mail-Anbieter ergänzen</Placeholder>.
          </StaffOnly>
        </p>
        <p>
          Hat die Fahrschule den SMS-Versand eingerichtet, erhalten Sie
          Termininformationen auch per SMS an die hinterlegte Mobilnummer.{" "}
          <Placeholder>
            Falls die Fahrschule SMS oder Messenger nutzt: Anbieter, Zweck und
            Rechtsgrundlage ergänzen
          </Placeholder>
        </p>
      </LegalSection>

      <LegalSection title="7. Empfänger">
        <p>
          Eine Weitergabe erfolgt nur, soweit sie für die Ausbildung oder aufgrund
          gesetzlicher Pflichten erforderlich ist.{" "}
          <Placeholder>
            Empfänger ergänzen, z. B. Fahrerlaubnisbehörde, Technische Prüfstelle,
            Steuerberatung
          </Placeholder>
        </p>
      </LegalSection>

      <LegalSection title="8. Speicherdauer">
        <p>
          Personenbezogene Daten werden gelöscht oder anonymisiert, sobald der Zweck ihrer
          Verarbeitung entfällt und keine gesetzliche Aufbewahrungspflicht entgegensteht.
          Die Software der Fahrschule ermittelt täglich, welche Daten ihre Frist erreicht
          haben, und löscht bzw. anonymisiert sie nach folgendem Löschkonzept. Die
          Ausbildung gilt als beendet, sobald die Fahrschule Ihre Akte archiviert (nach
          bestandener Prüfung, Abbruch oder Wechsel der Fahrschule).
          <StaffOnly>
            {" "}
            Hinweis für die Fahrschule: Im Löschmodus „Nach Bestätigung“ werden fällige
            Daten erst gelöscht, wenn Sie den Löschlauf unter Fahrschule &amp;
            Einstellungen → Datenschutz bestätigen. Bestätigen Sie ihn regelmäßig, damit
            diese Angaben zutreffen, und archivieren Sie Fahrschüler/innen zeitnah nach
            dem Ende der Ausbildung.
          </StaffOnly>
        </p>
        <List
          items={[
            `Terminanfragen, aus denen keine Ausbildung wird: Name, Kontaktdaten und Nachricht ${period("anfragen")} nach Eingang der Anfrage (danach bleibt nur ein anonymer Eintrag für die Statistik).`,
            `Hochgeladene Dokumente (z. B. Sehtest, Passbild, Erste-Hilfe-Nachweis, Antragsunterlagen): ${period("dokumente")} nach Ende der Ausbildung.`,
            `Nachrichten im Schülerportal/Chat: ${period("chat")} nach der letzten Nachricht, frühestens ${period("chat")} nach Ende der Ausbildung.`,
            `Zugangslinks zum Schülerportal: mit dem Ende der Ausbildung; gesperrte Links ${period("portal")} nach der Sperrung.`,
            `Versandte E-Mails und SMS (Empfänger, Text): ${period("nachrichten")} nach Versand.`,
            `Ausbildungsnachweis mit Ihrer Unterschrift (§ 31 Fahrlehrergesetz): ${period("ausbildungsnachweis")} nach Ablauf des Jahres, in dem die Ausbildung beendet wurde; danach wird er gelöscht.`,
            `Stammdaten (Name, Anschrift, Geburtsdatum, Kontaktdaten, Begleitperson) und Ihr Name in Terminen: ${period("schueler")} nach Ablauf des Jahres, in dem die Ausbildung endete; danach wird der Name durch ein Pseudonym („Gelöscht #Nummer“) ersetzt und die übrigen Angaben werden gelöscht.`,
            `Buchungen, Rechnungen, Quittungen und Lastschriftdaten: Die steuer- und handelsrechtlichen Fristen (§ 147 AO, § 257 HGB, § 14b UStG) betragen für Bücher und Aufzeichnungen 10 Jahre und für Buchungsbelege wie Rechnungen 8 Jahre, jeweils ab Ende des Kalenderjahres. Weil Buchungen und Rechnungen zusammen geführt werden, ersetzen wir Ihren Namen, Ihre Anschrift und Ihre Bankverbindung darin einheitlich ${period("buchhaltung")} nach Ablauf des Jahres Ihrer letzten Buchung bzw. Rechnung durch ein Pseudonym; Beträge und Belegnummern bleiben erhalten.`,
            `Protokoll der Änderungen durch Mitarbeitende der Fahrschule (enthält Benutzer, Adresse der Änderung und IP-Adresse): ${period("protokoll")} nach dem Eintrag.`,
          ]}
        />
        <p>
          Die Fristen verlängern sich nur, soweit die Daten für ein laufendes Verfahren
          (z. B. Rechtsstreit, Betriebsprüfung, offene Forderung) benötigt werden; in
          dieser Zeit ist die Verarbeitung eingeschränkt. Datensicherungen werden nach
          einem festen Turnus überschrieben, sodass gelöschte Daten auch dort nach kurzer
          Zeit nicht mehr vorhanden sind.
          <StaffOnly>
            {" "}
            Turnus der Datensicherungen:{" "}
            <Placeholder>
              Anzahl Tage ergänzen – Standard: 14 Sicherungen im Abstand von 24 Stunden
              (BACKUP_KEEP, BACKUP_INTERVAL_HOURS), also etwa 14 Tage
            </Placeholder>
            .
          </StaffOnly>
        </p>
      </LegalSection>

      <LegalSection title="9. Ihre Rechte">
        <p>Sie haben gegenüber der Fahrschule folgende Rechte:</p>
        <List
          items={[
            "Auskunft über die gespeicherten Daten (Art. 15 DSGVO)",
            "Berichtigung unrichtiger Daten (Art. 16 DSGVO)",
            "Löschung (Art. 17 DSGVO), soweit keine Aufbewahrungspflicht entgegensteht",
            "Einschränkung der Verarbeitung (Art. 18 DSGVO)",
            "Datenübertragbarkeit (Art. 20 DSGVO)",
            "Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO (Art. 21 DSGVO)",
          ]}
        />
        <p>
          Beantragen Sie die Löschung, löschen wir sofort alles, was keiner
          Aufbewahrungspflicht unterliegt (z. B. Kontaktdaten, Dokumente, Chat, E-Mails).
          Daten, die wir aufbewahren müssen (Ausbildungsnachweis, Buchhaltung), sperren
          wir bis zum Ende der jeweiligen Frist und löschen bzw. anonymisieren sie dann;
          wir teilen Ihnen mit, welche Daten das sind und bis wann.
        </p>
        <p>
          Über Berichtigungen, Löschungen und Einschränkungen informiert die Fahrschule
          etwaige Empfänger (Art. 19 DSGVO).
        </p>
      </LegalSection>

      <LegalSection title="10. Beschwerderecht">
        <p>
          Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren
          (Art. 77 DSGVO), insbesondere in dem Bundesland Ihres Wohnorts oder des Sitzes
          der Fahrschule.
          <StaffOnly>
            {" "}
            Zuständig für die Fahrschule:{" "}
            <Placeholder>Landesdatenschutzbehörde ergänzen</Placeholder>.
          </StaffOnly>
        </p>
      </LegalSection>

      <StaffOnly>
        <p className="text-sm text-muted-foreground">
          Stand: <Placeholder>Datum ergänzen</Placeholder>
        </p>
      </StaffOnly>
    </div>
  );
}

export function Datenschutz() {
  return (
    <LegalPage title="Datenschutzerklärung">
      {(info) => <DatenschutzContent info={info} />}
    </LegalPage>
  );
}

export default Datenschutz;
