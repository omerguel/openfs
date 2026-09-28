> **ENTWURF — von Rechtsberatung und Steuerberatung zu prüfen.**
> Dieses Löschkonzept beschreibt, was die Software OpenFS tatsächlich löscht bzw.
> anonymisiert (Stand des Codes: `src/lib/retention.ts`, `src/server/retention.ts`,
> `src/server/privacy.ts`, `src/server/engine.ts`). Die rechtliche Einordnung ist nach
> bestem Wissen recherchiert, aber **keine Rechtsberatung**. Jede Stelle mit
> **⚠ Prüfen** muss eine Anwältin/ein Anwalt bzw. die Steuerberatung bestätigen oder
> korrigieren, bevor sich eine Fahrschule darauf beruft. Verantwortlich im Sinne der
> DSGVO ist die Fahrschule, nicht der Softwareanbieter.

# Löschkonzept OpenFS (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO)

## 1. Grundsätze

1. Personenbezogene Daten werden nur so lange gespeichert, wie es für ihren Zweck
   erforderlich ist (Speicherbegrenzung, Art. 5 Abs. 1 lit. e DSGVO), oder so lange eine
   gesetzliche Aufbewahrungspflicht besteht (Art. 17 Abs. 3 lit. b DSGVO). Während einer
   Aufbewahrungspflicht werden die Daten nicht mehr aktiv genutzt, sondern nur noch
   vorgehalten (faktische Einschränkung der Verarbeitung).
2. **Löschen oder anonymisieren.** Wo Daten Teil eines Nachweises sind, der selbst bleiben
   muss oder statistisch weiter gebraucht wird, wird der Personenbezug entfernt
   (Pseudonym „Gelöscht #&lt;Schüler-ID&gt;“, Kontaktfelder geleert). Wo nichts bleiben muss,
   wird die Zeile gelöscht.
3. **Beginn der Fristen.** Die meisten schülerbezogenen Fristen beginnen mit der
   **Archivierung** der Fahrschülerin/des Fahrschülers (Menü *Archivieren*, das
   entspricht dem Ende der Ausbildung: bestanden, abgebrochen, Wechsel). Eine Fahrschule,
   die Schüler nach dem Ende der Ausbildung nicht archiviert, verlängert damit
   unbemerkt alle Fristen; die Löschvorschau weist auf inaktive, nicht archivierte
   Schüler hin. Fristen mit „ab Jahresende“ beginnen am 31.12. des Jahres des
   Startereignisses (§ 147 Abs. 4 AO; § 31 FahrlG).
4. **Fristende.** Ein Datensatz ist fällig, wenn der letzte Tag der Frist *vor* dem
   heutigen Tag liegt (`periodOver`: `periodEnd(start, Monate, abJahresende) < heute`),
   gerechnet in Kalendermonaten nach der Zeitzone der Fahrschule (`schoolToday`).
   Beispiel: Archivierung am 15.06.2025, Frist 5 Jahre ab Jahresende → Fristende
   31.12.2030 → fällig ab 01.01.2031.

## 2. Fristen je Kategorie

Die Fristen sind je Fahrschule unter **Fahrschule &amp; Einstellungen → Datenschutz**
einstellbar (nur Inhaber/in), innerhalb der angegebenen Grenzen. Gesetzlich
festgelegte Fristen sind gesperrt. Die öffentliche Datenschutzerklärung
(`/datenschutz`) zeigt automatisch die gespeicherten Werte.

| Kategorie (Schlüssel) | Standard | erlaubt | Beginn | Was geschieht | Rechtsgrundlage |
|---|---|---|---|---|---|
| Terminanfragen (`anfragen`) | 6 Monate | 1–36 Monate | Eingang der Anfrage | Name → „Gelöschte Anfrage“, Telefon, E-Mail, Nachricht geleert; Terminart/Wunschdatum/Kampagne bleiben (Statistik). Ein aus der Anfrage entstandener Termin ohne Schülerbezug heißt danach „Terminanfrage (gelöscht)“, Notiz geleert. | Art. 6 Abs. 1 lit. b (vorvertraglich), Art. 5 Abs. 1 lit. e, Art. 17 Abs. 1 lit. a DSGVO; keine Aufbewahrungspflicht |
| Hochgeladene Dokumente (`dokumente`) | 6 Monate | 0–60 Monate | Archivierung | Datei im Dateispeicher (S3 bzw. `data/files`) und Metadaten gelöscht | Art. 17 Abs. 1 lit. a DSGVO |
| Chat/Portal-Nachrichten (`chat`) | 6 Monate | 0–72 Monate | letzte Nachricht, frühestens Archivierung | Unterhaltung mit allen Nachrichten gelöscht | Art. 17 Abs. 1 lit. a DSGVO |
| Widerrufene Portal-Links (`portal`) | 1 Monat | 0–12 Monate | Widerruf | Link-Datensatz gelöscht | Art. 5 Abs. 1 lit. c, e DSGVO |
| E-Mail-/SMS-Protokoll (`nachrichten`) | 6 Monate | 1–72 Monate | Versand (bzw. Anlage, wenn nie versendet) | Eintrag im Postausgang (Empfänger, Betreff, Text, Anhänge) gelöscht; wartende Nachrichten nie | Art. 17 Abs. 1 lit. a DSGVO |
| Änderungsprotokoll (`protokoll`) | 12 Monate | 3–72 Monate | Protokolleintrag | Einträge gelöscht, außer Einträgen der Löschläufe selbst (`LOESCHLAUF`) | Art. 5 Abs. 1 lit. e, Art. 32 DSGVO (Nachvollziehbarkeit) |
| Ausbildungsnachweise (`ausbildungsnachweis`) | 5 Jahre | fest | 31.12. des Jahres der Archivierung | alle unterschriebenen Nachweise der Person gelöscht (inkl. Unterschriftsbild) | § 31 FahrlG i. V. m. § 6 FahrSchAusbO |
| Schülerstammdaten (`schueler`) | 5 Jahre | 5–10 Jahre | 31.12. des Jahres der Archivierung | siehe Abschnitt 3.1 | § 31 FahrlG (Nachweis nennt die Person), §§ 195, 199 BGB, danach Art. 17 DSGVO |
| Buchhaltung (`buchhaltung`) | 10 Jahre | 10–11 Jahre | 31.12. des Jahres der letzten Buchung bzw. Rechnung der Kundennummer | siehe Abschnitt 4 | § 147 Abs. 1, 3, 4 AO, § 257 Abs. 1, 4, 5 HGB, § 14b UStG |

### 2.1 Begründung und offene Punkte je Kategorie

**Terminanfragen, die nie zur Ausbildung führten.** Keine Aufbewahrungspflicht; die
Anfrage dient nur der Terminvereinbarung. 6 Monate lassen Rückfragen und eine spätere
Anmeldung zu. Anfragen mit Verknüpfung zu einem aktiven Schüler werden nicht angefasst
(sie gehören zur Schülerakte); wird der Schüler archiviert, wird die Verknüpfung gelöst
und die Anfrage fällt wieder unter diese Frist.
**⚠ Prüfen:** Ob abgelehnte Anfragen als empfangene Geschäftsbriefe (§ 257 Abs. 1 Nr. 2
HGB, 6 Jahre) gelten können — wir gehen davon aus, dass eine unverbindliche Terminanfrage
ohne Vertragsschluss kein Handelsbrief ist.

**Hochgeladene Dokumente** (Sehtest, Passbild, Erste-Hilfe-Nachweis, Antragsunterlagen).
Es handelt sich um Kopien; die Originale bzw. der Führerscheinantrag liegen bei der
Fahrerlaubnisbehörde. **⚠ Prüfen:** ob die Fahrschule einzelne Unterlagen (z. B. eine
unterschriebene Ausbildungsvertrags-Kopie) länger aufbewahren muss — dann gehört das
Dokument nicht in den Upload, sondern ist als Vertrag/Geschäftsbrief (6 Jahre) zu
behandeln, oder die Frist ist hochzusetzen. Ohne konfigurierten Dateispeicher werden
Dokumente nicht gelöscht (die Zeile bleibt, damit keine verwaisten Dateien entstehen).

**Chat und Schülerportal-Nachrichten.** Kommunikation zur Durchführung der Ausbildung.
**⚠ Prüfen:** Enthält ein Chat Absprachen, die einen Vertrag vorbereiten, abschließen
oder ändern (Handels- oder Geschäftsbriefe, § 257 Abs. 1 Nr. 2, 3 HGB, § 147 Abs. 1
Nr. 2, 3 AO), gilt eine Aufbewahrungsfrist von 6 Jahren. Die Software unterscheidet
nicht nach Inhalt; die Fahrschule muss entweder die Frist erhöhen (bis 72 Monate) oder
solche Absprachen außerhalb des Chats dokumentieren. Hinweis dazu steht im
Einstellungs-Tab.

**Portal-Links.** Mit der Archivierung wird der Link sofort gelöscht (auch ohne
Löschlauf, `deleteStudent`). Nur widerrufene Links eines noch aktiven Schülers bleiben
kurz, damit nachvollziehbar ist, wann ein Link gesperrt wurde.

**E-Mail-/SMS-Protokoll** (Tabelle `outbox`). Rechnungen und Mahnungen sind eigene
Belege in der Buchhaltung und bleiben dort; die Kopie im Postausgang ist nur ein
Versandnachweis. **⚠ Prüfen (Steuerberatung):** ob versandte Mails mit Rechnung im
Anhang als „abgesandte Handels- oder Geschäftsbriefe“ (6 Jahre) im Postausgang
aufzubewahren sind, obwohl die Rechnung selbst im System bleibt. Falls ja: Frist auf
72 Monate stellen. SMS-Versandprotokolle beim Anbieter (seven.io) unterliegen dessen
Löschfristen, siehe AVV-Vorlage.

**Änderungsprotokoll** (`audit_log`: Zeitpunkt, Benutzer-ID und -E-Mail, Methode, Pfad,
HTTP-Status, IP-Adresse — keine Inhalte). Zweck: Nachvollziehbarkeit und Sicherheit
(Art. 32 DSGVO), Aufklärung von Fehlbedienung. 12 Monate sind eine übliche Abwägung.
**⚠ Prüfen:** Ist das Protokoll Teil der Verfahrensdokumentation im Sinne der GoBD?
Die Buchungen selbst sind unveränderbar und tragen Zeitstempel; das
Protokoll ist daher nach unserer Einschätzung keine aufbewahrungspflichtige Unterlage
nach § 147 AO. Einträge der Löschläufe (Methode `LOESCHLAUF`, nur Anzahlen) werden
nie automatisch gelöscht, damit die Löschung selbst nachweisbar bleibt.

**Ausbildungsnachweise.** § 31 FahrlG (Fahrlehrergesetz 2018; vor 2018: § 18 FahrlG
a. F.) verpflichtet den Inhaber der Fahrschulerlaubnis, Ausbildungsnachweis und
Tagesnachweis nach Ablauf des Jahres, in dem die Ausbildung abgeschlossen wurde,
**fünf Jahre** aufzubewahren und danach **unverzüglich zu löschen bzw. zu vernichten**.
Deshalb ist diese Frist gesperrt (weder kürzer noch länger). Der Ausbildungsnachweis
folgt dem Muster der Anlage 3 zu § 6 FahrSchAusbO.
**⚠ Prüfen:** (a) Die Software verwendet als „Jahr des Ausbildungsabschlusses“ das Jahr
der **Archivierung**. Wird erst Monate nach der Prüfung archiviert und fällt das in das
Folgejahr, verschiebt sich das Fristende um ein Jahr — die Fahrschule sollte zeitnah
archivieren. (b) Der **Tagesnachweis** (§ 31 FahrlG) wird in OpenFS nicht als eigenes
Dokument geführt; die Arbeitszeitauswertung wird aus den Terminen berechnet. Termine
bleiben nach der Pseudonymisierung (ohne Schülernamen) mit Fahrlehrer, Datum und Dauer
erhalten. Ob die Fahrschule den Tagesnachweis damit erfüllt, ist separat zu klären.
(c) Die Pflicht zur unverzüglichen Löschung kollidiert nicht mit der Buchhaltung, weil
die Buchungen die Nachweise nicht enthalten.

**Schülerstammdaten.** Solange Ausbildungsnachweise aufbewahrt werden, muss die Person
identifizierbar bleiben (der Nachweis trägt Namen, Anschrift, Geburtsdatum). Zusätzlich
gilt die regelmäßige Verjährungsfrist von 3 Jahren ab Jahresende (§§ 195, 199 BGB) für
Ansprüche aus dem Ausbildungsvertrag; sie ist in den 5 Jahren enthalten. Die
Stammdatenfrist ist daher mindestens so lang wie die Nachweisfrist (Untergrenze 60
Monate) und kann bis 10 Jahre verlängert werden, wenn die Fahrschule das begründen kann
(z. B. längere Verjährung bei bestimmten Ansprüchen). **⚠ Prüfen:** ob 5 Jahre als
Standard angemessen sind oder ob kürzer (3 Jahre) geboten wäre, wenn keine
Ausbildungsnachweise vorhanden sind (z. B. Abbruch vor der ersten Fahrstunde). Die
Software unterscheidet diesen Fall beim Fristablauf nicht, wohl aber bei der Löschung
auf Antrag (Abschnitt 5).

**Buchhaltung.** Siehe Abschnitt 4.

**Nicht (automatisch) erfasste Daten** — **⚠ Prüfen / manuell regeln:**

- **Mitarbeitende** (Benutzerkonten, Fahrlehrer-Stammdaten, Abwesenheiten,
  Arbeitszeiten): nicht Teil dieses Löschkonzepts; Personalakten-Fristen
  (u. a. § 147 AO für Lohnunterlagen, § 17 MiLoG, § 16 ArbZG) sind anders zu
  behandeln. Benutzerkonten werden deaktiviert, nicht gelöscht, damit Protokoll und
  Ausbildungsnachweise (Namens-Schnappschuss des Fahrlehrers) konsistent bleiben.
- **Bewertungen** (Google-Import, Autorname und Text): öffentliche Daten, keine
  Löschfrist in der Software; ausblenden bzw. von Hand löschen.
- **Aktive Fahrschüler/innen** werden nie automatisch gelöscht, auch wenn sie lange
  inaktiv sind — erst archivieren.
- **Theorie-Anwesenheit** wird bereits beim Archivieren gelöscht (`deleteStudent`).
- **Archivierte Einträge anderer Art** (Fahrlehrer, Fahrzeuge, Preispläne) im Archiv.

## 3. Was der tägliche Löschlauf genau tut

### 3.1 Ablauf

- `startRetentionScheduler` läuft **je Fahrschule** (im Multi-Tenant-Betrieb je Mandant,
  mit dessen eigener Datenbank und dessen eigenem Dateispeicher-Präfix), prüft stündlich
  und arbeitet **einmal pro Kalendertag** (Merker `retention_last_job` in `settings`).
- **Immer (Housekeeping, ohne Bestätigung):** abgelaufene Anmeldesitzungen löschen
  (Sitzungen gleiten 7 Tage), Einladungslinks löschen, die seit mehr als 30 Tagen
  abgelaufen sind.
- **Löschmodus „Nach Bestätigung“ (Standard):** der Lauf löscht nichts. Die fälligen
  Datensätze erscheinen in der **Löschvorschau**; die Inhaberin/der Inhaber bestätigt
  sie mit *Löschlauf ausführen*. Die Bestätigung trägt eine Prüfsumme (`hash`) über
  Datum, Kategorien, IDs und Anzahlen; hat sich die Vorschau inzwischen geändert, wird
  der Lauf abgelehnt (HTTP 409) und muss neu bestätigt werden. So wird genau das
  gelöscht, was angezeigt wurde.
- **Löschmodus „Automatisch“:** der tägliche Lauf führt die Vorschau ohne Rückfrage aus.
- Vorschau (`planRetention`) und Ausführung (`executeRetention`) verwenden dieselbe
  Liste; die Ausführung läuft in einer Datenbank-Transaktion, Dateien werden danach aus
  dem Dateispeicher entfernt. Ein zweiter Lauf am selben Tag findet nichts mehr
  (idempotent).

### 3.2 Schülerstammdaten anonymisieren (`anonymiseArchivedStudent`)

Archivierte Schüler liegen als Schnappschuss in der Tabelle `archive`. Bei Fälligkeit:

- Vorname → „Gelöscht“, Nachname → „#&lt;ID&gt;“, Archiv-Bezeichnung → „Gelöscht #&lt;ID&gt;“;
  Telefon, E-Mail, Anschrift, Geburtsdatum, Begleitperson, Führerschein-Erteilungsdatum,
  Checklisten geleert. Kunden- und Vertragsnummer bleiben (Bezug zur Buchhaltung).
- Termine der Person (beim Archivieren gemerkt; bei älteren Archiven über den Namen, nur
  wenn kein aktiver Schüler gleichen Namens existiert): Name in Titel/Untertitel →
  Pseudonym, Notiz geleert. Fahrlehrer, Datum, Dauer, Fahrzeug bleiben.
- Postausgang-Einträge an E-Mail/Telefon der Person gelöscht; Terminanfragen mit dieser
  E-Mail/Telefonnummer anonymisiert; Chat-Unterhaltungen der Person gelöscht;
  Portal-Links gelöscht; hochgeladene Dateien gelöscht.
- Eintrag in `privacy_erasures` (Art `frist`) mit Kundennummer — damit die Buchhaltung
  später gefunden wird.
- SEPA-Mandate: Kontoinhaber → Pseudonym, IBAN/BIC geleert — sofort, wenn es zur
  Kundennummer keine Buchungen/Rechnungen gibt, sonst mit der Buchhaltung (Abschnitt 4).

### 3.3 Aufbewahrung verlängern (Legal Hold)

Unter *Datenschutz → Aufbewahrung verlängert* bzw. im Menü der Schülerseite kann die
Inhaberin/der Inhaber für eine Person mit Grund (Pflicht) und optionalem Enddatum
eintragen, dass nichts gelöscht wird (Rechtsstreit, offene Forderung, Betriebsprüfung,
Anfrage einer Behörde). Wirkung: Die Person fällt aus **allen schülerbezogenen
Kategorien** (Dokumente, Chat, Ausbildungsnachweise, Stammdaten, Buchhaltung) und eine
Löschung auf Antrag ist gesperrt, bis die Verlängerung aufgehoben ist oder ihr Datum
vorbei ist. Nicht schülerbezogene Kategorien (Anfragen ohne Schüler, Postausgang,
Protokoll, Lastschriftdateien) sind davon nicht betroffen. **⚠ Prüfen:** Die Fahrschule
muss die Einschränkung dokumentieren (Art. 18 DSGVO) und die Verlängerung aufheben,
sobald der Grund entfällt; die Software erinnert nicht aktiv daran.

### 3.4 Protokollierung

Jeder Lauf (automatisch, bestätigt oder auf Antrag) wird in `retention_runs` und im
Änderungsprotokoll (Methode `LOESCHLAUF`) festgehalten — **nur Anzahlen je Kategorie**,
Auslöser und Benutzer, keine Namen oder Inhalte. Die letzten Läufe stehen im
Datenschutz-Tab.

## 4. Buchhaltung und GoBD

Buchungen (`transactions`, `bookings`), Rechnungen (`invoices`) und Quittungen sind nach
GoBD unveränderbar; Korrekturen nur per Storno. Während der Aufbewahrungsfrist werden
sie vom Löschkonzept **nicht verändert** — auch nicht bei einem Löschantrag (Art. 17
Abs. 3 lit. b DSGVO). Tests prüfen, dass Buchungen, Rechnungen und Nummernkreise
während der Frist byte-gleich bleiben.

**Fristen.** Seit dem Vierten Bürokratieentlastungsgesetz (BEG IV, in Kraft 01.01.2025)
gilt:

- Bücher und Aufzeichnungen, Inventare, Jahresabschlüsse, Lageberichte,
  Eröffnungsbilanz, Arbeitsanweisungen und Organisationsunterlagen: **10 Jahre**
  (§ 147 Abs. 1 Nr. 1, Abs. 3 AO; § 257 Abs. 1 Nr. 1, Abs. 4 HGB).
- **Buchungsbelege** (z. B. Rechnungen, Quittungen, Kontoauszüge): **8 Jahre** statt
  bisher 10 (§ 147 Abs. 1 Nr. 4, Abs. 3 AO n. F.; § 257 Abs. 1 Nr. 4, Abs. 4 HGB n. F.;
  § 14b Abs. 1 UStG n. F.). Die Verkürzung gilt für alle Unterlagen, deren Frist am
  01.01.2025 noch nicht abgelaufen war (Übergangsregel im EGAO/EGHGB). Für
  bestimmte beaufsichtigte Unternehmen (Kreditinstitute, Versicherungen,
  Wertpapierinstitute) gelten Ausnahmen bzw. eine spätere Anwendung — nicht relevant
  für Fahrschulen. **⚠ Prüfen (Steuerberatung):** genaue Fundstellen der
  Übergangsregel und ob seit 2025 weitere Änderungen beschlossen wurden.
- Empfangene und abgesandte Handels- oder Geschäftsbriefe, sonstige steuerlich
  relevante Unterlagen: **6 Jahre** (§ 147 Abs. 1 Nr. 2, 3, 5, Abs. 3 AO; § 257 Abs. 1
  Nr. 2, 3, Abs. 4 HGB).
- Fristbeginn: Schluss des Kalenderjahres, in dem die letzte Eintragung gemacht bzw. die
  Unterlage entstanden ist (§ 147 Abs. 4 AO, § 257 Abs. 5 HGB).
- **Ablaufhemmung:** Die Frist läuft nicht ab, solange die Unterlagen für Steuern von
  Bedeutung sind, deren Festsetzungsfrist noch nicht abgelaufen ist (§ 147 Abs. 3 AO,
  z. B. laufende Außenprüfung, Einspruch). Das kann die Software nicht erkennen — die
  Fahrschule muss dann *Aufbewahrung verlängern* eintragen bzw. die Buchhaltungsfrist
  auf 11 Jahre setzen.

**Was OpenFS tut.** Der Name einer Kundin/eines Kunden steht sowohl im Buchungsjournal
(Buchungstext, Name/Anschrift je Buchung — „Bücher/Aufzeichnungen“, 10 Jahre) als auch
in Rechnungen („Buchungsbelege“, 8 Jahre). Die Software behandelt beides **einheitlich
mit 10 Jahren** (einstellbar 10–11), gerechnet ab dem 31.12. des Jahres der
**letzten** Buchung bzw. Rechnung dieser Kundennummer. Erst wenn

1. die Stammdaten der Person bereits anonymisiert sind (`privacy_erasures`, Art
   `frist`) **und**
2. alle Buchungen und Rechnungen der Kundennummer außerhalb der Frist liegen **und**
3. keine Aufbewahrungsverlängerung eingetragen ist,

ersetzt `pseudonymiseExpiredCustomer` (`src/server/engine.ts`) in Buchungen,
Buchungszeilen und Rechnungen den Namen (auch innerhalb von Buchungstext,
Rechnungspositionen und Rechnungsnotiz) durch das Pseudonym und leert die Anschrift;
SEPA-Mandate verlieren Kontoinhaber, IBAN und BIC. **Beträge, Konten, Daten, Beleg-,
Buchungs- und Rechnungsnummern, Nummernkreise und Salden bleiben unverändert; keine
Zeile wird gelöscht oder hinzugefügt.** Die Funktion verweigert die Änderung
(Fehler), solange auch nur ein Datensatz der Kundennummer in der Frist liegt; die
Untergrenze von 120 Monaten ist im Code fest verankert.

Erzeugte **SEPA-Lastschriftdateien** (pain.008-XML mit Namen und IBAN) werden 10 Jahre
nach dem Einzugsdatum geleert; der Datensatz (Nachrichten-ID, Datum, Summe) bleibt.

Dies ist die **einzige** Stelle, an der OpenFS Buchungen nachträglich verändert. Sie ist
bewusst eng: nur Personenbezug, nur nach Ablauf der Aufbewahrungsfrist, nur über eine
Funktion in `engine.ts`. **⚠ Prüfen (Steuerberatung):**

- ob die einheitliche 10-Jahres-Frist für Rechnungsnamen akzeptiert wird, obwohl
  Rechnungen seit 2025 nur 8 Jahre aufbewahrt werden müssen (Datensparsamkeit spräche
  für eine getrennte Behandlung; technisch steht derselbe Name aber im Journal);
- ob nach Fristablauf die Pseudonymisierung statt Löschung genügt bzw. geboten ist
  (die Buchhaltung muss rechnerisch vollständig bleiben: Summen, Salden, Vorträge);
- ob die DATEV-Exporte und bereits an die Steuerberatung übermittelte Daten eigenen
  Fristen beim Empfänger unterliegen (außerhalb der Software).

## 5. Betroffenenrechte

### 5.1 Auskunft (Art. 15 DSGVO)

*Datenschutz → Betroffenenrechte* bzw. Schülerseite → Menü → *Auskunft (Art. 15)*
(nur Inhaber/in). Liefert für aktive und archivierte Personen eine druckbare Seite
(„Drucken / als PDF speichern“) und eine JSON-Datei mit: Stammdaten, Termine,
Ausbildungsnachweis (ohne das Unterschriftsbild, mit Vermerk), Theorie-Anwesenheit,
Buchungen, Rechnungen, SEPA-Mandate, Ratenpläne, hochgeladene Dokumente (Liste — die
Dateien selbst stellt die Fahrschule als Kopie bereit), Chat-/Portalnachrichten,
versandte E-Mails und SMS, Terminanfragen, Portal-Zugänge (ohne den geheimen Link) sowie
die Pflichtangaben nach Art. 15 Abs. 1 lit. a–h (Zwecke, Kategorien, Empfänger,
Speicherdauer aus den aktuellen Fristen, Rechte, Herkunft, keine automatisierte
Entscheidung). **⚠ Prüfen:** Empfängerliste an die tatsächlichen Empfänger der
Fahrschule anpassen; Frist von einem Monat (Art. 12 Abs. 3 DSGVO) hält die Fahrschule
ein; Identität der anfragenden Person prüfen.

### 5.2 Löschen auf Antrag (Art. 17 DSGVO)

Vor der Ausführung zeigt der Dialog, was **sofort** gelöscht wird und was **bis wann**
aufbewahrt werden muss (mit Rechtsgrundlage — zur Mitteilung an die Person nach
Art. 12 Abs. 4, Art. 17 Abs. 3 lit. b DSGVO). Ausführung:

1. Ist die Person noch aktiv, wird sie archiviert (Grund „Löschung auf Antrag“).
2. **Sofort:** Telefon, E-Mail, Begleitperson, Checklisten, hochgeladene Dokumente,
   Chat, Postausgang an ihre Adressen, Portal-Links; Terminanfragen mit ihren
   Kontaktdaten werden anonymisiert.
3. **Gibt es Ausbildungsnachweise:** Name, Geburtsdatum, Anschrift und die Nachweise
   bleiben bis zum Ende der § 31 FahrlG-Frist gesperrt (`privacy_erasures` Art `antrag`
   mit Datum). Danach erledigt der Löschlauf den Rest wie bei Fristablauf — unabhängig
   von einer länger eingestellten Stammdatenfrist.
4. **Gibt es keine Ausbildungsnachweise:** Name und übrige Stammdaten werden sofort
   anonymisiert; ohne Buchungen auch die SEPA-Mandate.
5. **Buchungen/Rechnungen** bleiben bis zum Ende der Buchhaltungsfrist unverändert und
   werden dann pseudonymisiert (Abschnitt 4).
6. Bei eingetragener *Aufbewahrung verlängern* ist die Löschung gesperrt.

**⚠ Prüfen:** Ob bei einem Antrag vor Ausbildungsende (Vertrag läuft noch) zuerst der
Vertrag beendet werden muss; die Software prüft das nicht. Ob Empfänger nach Art. 19
DSGVO zu informieren sind (z. B. Steuerberatung) — organisatorisch.

## 6. Datensicherungen

Sicherungen sind vollständige Kopien der Datenbank (`VACUUM INTO`), lokal unter
`BACKUP_DIR` und — bei konfiguriertem S3 — zusätzlich im Objektspeicher. Es bleiben die
neuesten `BACKUP_KEEP` Sicherungen (Standard 14) bei einem Intervall von
`BACKUP_INTERVAL_HOURS` (Standard 24 Stunden), ältere werden an beiden Orten gelöscht.
Gelöschte Daten sind daher bis zu **etwa `BACKUP_KEEP × BACKUP_INTERVAL_HOURS`**
(Standard ≈ 14 Tage) noch in Sicherungen enthalten und verschwinden dann mit deren
Rotation. Hochgeladene Dateien sind nicht Teil der Datenbanksicherung; im Dateispeicher
gelöschte Dateien sind sofort weg, außer der S3-Anbieter hält Versionen vor
(**⚠ Prüfen:** Objekt-Versionierung/Papierkorb beim Anbieter deaktiviert oder befristet?).
Wird eine Sicherung eingespielt, sind zuvor gelöschte Daten wieder vorhanden; der
nächste Löschlauf findet sie erneut (die Fristen gelten unverändert), im Modus
„Nach Bestätigung“ muss er allerdings bestätigt werden. **⚠ Prüfen:** Diese
Vorgehensweise (Löschung aus Backups durch Rotation statt gezielter Löschung) ist
verbreitet und nach herrschender Meinung zulässig, wenn die Frist kurz und dokumentiert
ist und Backups nicht anderweitig genutzt werden.

## 7. Technische Umsetzung (Schema)

- `settings.retention_policy` (JSON: Modus, Monate je Kategorie), `settings.retention_last_job`.
- `retention_holds (student_id, reason, until, created_at, created_by)`.
- `privacy_erasures (student_id, customer_no, kind 'frist'|'antrag', erased_at, retained_until, accounting_done_at)`.
- `retention_runs (id, at, trigger 'automatisch'|'bestaetigt'|'antrag', counts JSON, user_name)`.
- Das Archiv merkt sich beim Archivieren eines Schülers zusätzlich die Termin-IDs
  (`links.calendarEvents`), damit Wiederherstellen und Pseudonymisieren sie finden.
- API (nur Inhaber/in, `/api/admin/…`): `retention` (Übersicht), `retention/policy`,
  `retention/run` (mit `hash`), `retention/holds`, `privacy/subjects`,
  `privacy/students/:id/auskunft?format=html|download`, `privacy/students/:id/erasure`
  (GET Vorschau, POST Ausführung).
- Tests: `src/server/retention.test.ts` (jede Kategorie, Legal Hold, Vorschau = Lauf,
  Buchhaltung unverändert bis Fristende, Idempotenz, Isolation zweier Datenbanken,
  Auskunft, Löschung auf Antrag, Housekeeping), `src/server/tenancy.test.ts`
  (Einstellungen je Schule über HTTP).

## 8. Checkliste für Rechtsberatung / Steuerberatung

1. Buchhaltungsfrist einheitlich 10 Jahre für Journal und Rechnungen; BEG IV
   (8 Jahre für Buchungsbelege) und Übergangsregel bestätigen.
2. Pseudonymisierung der Buchhaltung nach Fristablauf statt Löschung.
3. Ablaufhemmung (§ 147 Abs. 3 AO) — Prozess „Aufbewahrung verlängern“ bei
   Außenprüfung/Einspruch.
4. § 31 FahrlG: Fristbeginn „Jahr der Archivierung“; Tagesnachweis außerhalb der
   Software; Pflicht zur unverzüglichen Vernichtung.
5. Stammdaten 5 Jahre ab Jahresende (auch ohne Ausbildungsnachweise).
6. Chat und versandte E-Mails: Handels-/Geschäftsbriefe (6 Jahre)?
7. Terminanfragen 6 Monate; hochgeladene Dokumente 6 Monate nach Ausbildungsende.
8. Änderungsprotokoll 12 Monate; Verhältnis zur GoBD-Verfahrensdokumentation.
9. Backup-Rotation als Löschung; S3-Versionierung.
10. Mitarbeiterdaten und Bewertungen — eigenes Konzept.
