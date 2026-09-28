# Rechtstexte — Vorlagen

**Alle Dateien in diesem Ordner sind Vorlagen ohne anwaltliche Prüfung. Sie sind keine
Rechtsberatung und dürfen erst verwendet werden, nachdem eine Rechtsanwältin/ein
Rechtsanwalt (und für Aufbewahrungsfristen die Steuerberatung) sie geprüft und an den
konkreten Betrieb angepasst hat.** Sie beschreiben die Software OpenFS so, wie sie im
Code umgesetzt ist; ändert sich die Software, sind die Texte nachzuziehen.

Konventionen: `[eckige Klammern]` = auszufüllen; **⚠ Prüfen** = offene Rechtsfrage,
vor Verwendung klären und den Vermerk entfernen.

| Datei | Was es ist | Wer verwendet es | Was auszufüllen ist |
|---|---|---|---|
| `agb-vorlage.md` | Allgemeine Geschäftsbedingungen für das OpenFS-Abonnement (B2B-SaaS, nur Unternehmer) | **Betreiber** von OpenFS gegenüber den Fahrschulen; wird bei der Registrierung (`PLATFORM_SIGNUP=1`) akzeptiert | Anbieterdaten, Tarife/Preise, Verfügbarkeit, Supportzeiten, Laufzeiten, Haftungshöchstbetrag, Gerichtsstand |
| `avv-vorlage.md` | Vertrag über die Auftragsverarbeitung nach Art. 28 DSGVO mit Anlage 1 (TOM, Art. 32) und Anlage 2 (Unterauftragsverarbeiter) | **Betreiber** (Auftragsverarbeiter) und **Fahrschule** (Verantwortliche) | Vertragsparteien, Kontakte, Meldefrist, Unterauftragsverarbeiter mit Anschrift und Standort (Hosting, S3, SMTP, SMS, Google), Anlage 1 Teil B (Betrieb: Rechenzentrum, TLS, Serverzugang, Verschlüsselung, Backup-Einstellungen, Wiederherstellungstests) |
| `verzeichnis-verarbeitungstaetigkeiten.md` | Verzeichnis der Verarbeitungstätigkeiten nach Art. 30 Abs. 1 DSGVO | **Fahrschule** als Verantwortliche (intern, auf Verlangen der Aufsichtsbehörde vorzulegen) | Kontaktdaten, Datenschutzbeauftragte/r, tatsächlich eingestellte Löschfristen, Empfänger, weitere Verarbeitungen außerhalb von OpenFS |
| `datenschutzhinweise-schueler.md` | Informationen nach Art. 13 DSGVO für Fahrschüler/innen (zum Aushändigen bei der Anmeldung) | **Fahrschule** gegenüber Schüler/innen und ggf. Erziehungsberechtigten | Kontaktdaten, Empfänger (Behörde, Prüfstelle, Steuerberatung, Dienstleister), eingestellte Fristen, Aufsichtsbehörde |

Weitere Dokumente außerhalb dieses Ordners:

- `docs/datenschutz/loeschkonzept.md` — Löschkonzept: was der tägliche Löschlauf genau
  löscht bzw. anonymisiert, mit Rechtsgrundlagen und einer Checkliste für Rechts- und
  Steuerberatung. Grundlage für die Fristen in allen Vorlagen.
- Die öffentlichen Seiten `/impressum` und `/datenschutz` der Software sind ebenfalls
  Vorlagen: sie zeigen angemeldeten Mitarbeitenden Platzhalter und einen Prüfhinweis,
  Besucher/innen nur den ausgefüllten Text. Die Datenschutzerklärung nennt automatisch
  die unter *Fahrschule & Einstellungen → Datenschutz* eingestellten Löschfristen.

## Was die Fahrschule (Inhaber/in) tun muss

1. AVV mit dem Betreiber abschließen (bei Registrierung akzeptiert — Fassung prüfen).
2. Unter *Fahrschule & Einstellungen → Rechtliches* Impressums- und Datenschutzangaben
   ausfüllen; `/datenschutz` prüfen und Platzhalter ergänzen.
3. Unter *Fahrschule & Einstellungen → Datenschutz* Löschfristen mit der
   Steuerberatung abstimmen, Löschmodus wählen und die Löschvorschau regelmäßig
   bestätigen; Fahrschüler/innen nach dem Ende der Ausbildung zeitnah archivieren.
4. Verzeichnis nach Art. 30 und die Schülerinformation nach Art. 13 anpassen und
   verwenden.
5. Auskunfts- und Löschanträge innerhalb eines Monats beantworten (Funktionen unter
   *Datenschutz → Betroffenenrechte*).

## Was der Betreiber tun muss

1. AGB und AVV anwaltlich prüfen lassen, Anlage 1 Teil B und Anlage 2 ausfüllen.
2. AV-Verträge mit allen Unterauftragsverarbeitern abschließen.
3. Ein dokumentiertes Verfahren für die Löschung eines Mandanten bei Vertragsende
   festlegen (Datenbank, Dateispeicher-Präfix, Sicherungen, Registereintrag) — die
   Software löscht Mandanten nicht automatisch.
