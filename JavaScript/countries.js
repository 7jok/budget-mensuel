/* Données par pays : devise, format des nombres, banques proposées,
   libellés des retenues sur salaire et produits d'épargne courants.
   Les banques sont de simples suggestions : on peut saisir n'importe quel nom. */
window.BUDGET_COUNTRIES = {
  CH: {
    en: { name: "Switzerland", soc: "Social contributions (AVS, AI, APG, AC, LPP)", tax: "Withholding tax (if it applies to you)" },
    de: { name: "Schweiz", soc: "Sozialabzüge (AHV, IV, EO, ALV, BVG)", tax: "Quellensteuer (falls Sie ihr unterstehen)" },
    name: 'Suisse', cur: 'CHF', locale: 'fr-CH',
    banks: ['UBS', 'PostFinance', 'Raiffeisen', 'Banque cantonale', 'Banque Migros', 'Banque Cler', 'Valiant', 'Yuh', 'neon', 'Revolut'],
    soc: 'Cotisations sociales (AVS, AI, APG, AC, LPP)',
    tax: 'Impôt à la source (si vous y êtes soumis)',
    cats: ['Assurance maladie (LAMal)', 'Provision impôts'],
    savings: ['3e pilier A', 'Compte épargne'],
    tz: ['Europe/Zurich']
  },
  FR: {
    en: { name: "France", soc: "Employee contributions", tax: "Tax withheld at source" },
    de: { name: "Frankreich", soc: "Arbeitnehmerbeiträge", tax: "Quellensteuer" },
    name: 'France', cur: 'EUR', locale: 'fr-FR',
    banks: ['Crédit Agricole', 'BNP Paribas', 'Société Générale', 'LCL', 'Crédit Mutuel', 'CIC', 'Banque Populaire', "Caisse d'Epargne", 'La Banque Postale', 'BoursoBank', 'Fortuneo', 'Hello bank!', 'Revolut', 'N26'],
    soc: 'Cotisations salariales',
    tax: 'Prélèvement à la source',
    cats: ['Mutuelle santé'],
    savings: ['Livret A', 'LDDS', 'Assurance vie', 'PEA'],
    tz: ['Europe/Paris']
  },
  BE: {
    en: { name: "Belgium", soc: "ONSS contributions", tax: "Withholding tax (précompte professionnel)" },
    de: { name: "Belgien", soc: "LSS-Beiträge (ONSS)", tax: "Berufssteuervorabzug (précompte professionnel)" },
    name: 'Belgique', cur: 'EUR', locale: 'fr-BE',
    banks: ['BNP Paribas Fortis', 'KBC', 'CBC', 'Belfius', 'ING Belgique', 'Argenta', 'Crelan', 'Keytrade Bank', 'Beobank', 'Revolut'],
    soc: 'Cotisations ONSS',
    tax: 'Précompte professionnel',
    cats: ['Mutualité et assurance hospitalisation'],
    savings: ["Compte d'épargne réglementé", 'Épargne-pension'],
    tz: ['Europe/Brussels']
  },
  LU: {
    en: { name: "Luxembourg", soc: "Social contributions (CNS, CNAP)", tax: "Wage tax withheld" },
    de: { name: "Luxemburg", soc: "Sozialbeiträge (CNS, CNAP)", tax: "Lohnsteuer" },
    name: 'Luxembourg', cur: 'EUR', locale: 'fr-LU',
    banks: ['Spuerkeess (BCEE)', 'BGL BNP Paribas', 'BIL', 'ING Luxembourg', 'Banque Raiffeisen', 'POST Luxembourg'],
    soc: 'Cotisations sociales (CNS, CNAP)',
    tax: 'Retenue d’impôt sur salaire',
    cats: ['Assurance santé complémentaire'],
    savings: ['Compte épargne', 'Prévoyance vieillesse'],
    tz: ['Europe/Luxembourg']
  },
  MC: {
    en: { name: "Monaco", soc: "Social contributions (CCSS, CAR)", tax: "Tax withheld (if any)" },
    de: { name: "Monaco", soc: "Sozialbeiträge (CCSS, CAR)", tax: "Einbehaltene Steuer (falls vorhanden)" },
    name: 'Monaco', cur: 'EUR', locale: 'fr-MC',
    banks: ['CFM Indosuez', 'Compagnie Monégasque de Banque', 'Banque Populaire Méditerranée', 'BNP Paribas', 'Société Générale'],
    soc: 'Cotisations sociales (CCSS, CAR)',
    tax: 'Impôt retenu (le cas échéant)',
    cats: ['Mutuelle santé'],
    savings: ['Compte épargne'],
    tz: ['Europe/Monaco']
  },
  CA: {
    en: { name: "Canada", soc: "Contributions (QPP or CPP, EI, QPIP)", tax: "Federal and provincial tax withheld" },
    de: { name: "Kanada", soc: "Beiträge (QPP oder CPP, EI, QPIP)", tax: "Einbehaltene Bundes- und Provinzsteuer" },
    name: 'Canada', cur: 'CAD', locale: 'fr-CA',
    banks: ['Desjardins', 'Banque Nationale', 'RBC Banque Royale', 'TD', 'Banque Scotia', 'BMO', 'CIBC', 'Tangerine'],
    soc: 'Cotisations (RRQ ou RPC, AE, RQAP)',
    tax: 'Impôt fédéral et provincial retenu',
    cats: ['Assurance collective'],
    savings: ['CELI', 'REER', 'CELIAPP'],
    tz: ['America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/Regina', 'America/St_Johns', 'America/Moncton']
  },
  DE: {
    en: { name: "Germany", soc: "Sozialversicherung (social contributions)", tax: "Lohnsteuer (wage tax)" },
    de: { name: "Deutschland", soc: "Sozialversicherung", tax: "Lohnsteuer" },
    name: 'Allemagne', cur: 'EUR', locale: 'de-DE',
    banks: ['Sparkasse', 'Volksbank Raiffeisenbank', 'Deutsche Bank', 'Commerzbank', 'ING', 'DKB', 'Postbank', 'comdirect', 'N26'],
    soc: 'Sozialversicherung (cotisations sociales)',
    tax: 'Lohnsteuer (impôt sur le salaire)',
    cats: ['Assurance maladie'],
    savings: ['Tagesgeld', 'Riester-Rente'],
    tz: ['Europe/Berlin']
  },
  AT: {
    en: { name: "Austria", soc: "Sozialversicherung (social contributions)", tax: "Lohnsteuer (wage tax)" },
    de: { name: "Österreich", soc: "Sozialversicherung", tax: "Lohnsteuer" },
    name: 'Autriche', cur: 'EUR', locale: 'de-AT',
    banks: ['Erste Bank und Sparkassen', 'Raiffeisen', 'Bank Austria', 'BAWAG', 'Volksbank', 'Oberbank', 'N26'],
    soc: 'Sozialversicherung (cotisations sociales)',
    tax: 'Lohnsteuer (impôt sur le salaire)',
    cats: ['Assurance maladie'],
    savings: ['Compte épargne', 'Bausparen'],
    tz: ['Europe/Vienna']
  },
  IT: {
    en: { name: "Italy", soc: "INPS contributions (social security)", tax: "IRPEF withheld" },
    de: { name: "Italien", soc: "INPS-Beiträge (Sozialversicherung)", tax: "Einbehaltene IRPEF" },
    name: 'Italie', cur: 'EUR', locale: 'it-IT',
    banks: ['Intesa Sanpaolo', 'UniCredit', 'Banco BPM', 'BPER Banca', 'BancoPosta', 'Fineco', 'Banca Mediolanum'],
    soc: 'Contributi INPS (cotisations sociales)',
    tax: 'IRPEF retenue',
    cats: ['Assurance santé'],
    savings: ['Libretto postale', 'Fondo pensione'],
    tz: ['Europe/Rome']
  },
  ES: {
    en: { name: "Spain", soc: "Seguridad Social (social contributions)", tax: "IRPF withholding" },
    de: { name: "Spanien", soc: "Seguridad Social (Sozialbeiträge)", tax: "IRPF-Einbehalt" },
    name: 'Espagne', cur: 'EUR', locale: 'es-ES',
    banks: ['Santander', 'BBVA', 'CaixaBank', 'Banco Sabadell', 'Bankinter', 'ING', 'Unicaja'],
    soc: 'Seguridad Social (cotisations sociales)',
    tax: 'Retención IRPF',
    cats: ['Assurance santé'],
    savings: ['Compte épargne', 'Plan de pensiones'],
    tz: ['Europe/Madrid', 'Atlantic/Canary']
  },
  PT: {
    en: { name: "Portugal", soc: "Segurança Social (social contributions)", tax: "IRS withholding" },
    de: { name: "Portugal", soc: "Segurança Social (Sozialbeiträge)", tax: "IRS-Einbehalt" },
    name: 'Portugal', cur: 'EUR', locale: 'pt-PT',
    banks: ['Caixa Geral de Depósitos', 'Millennium bcp', 'Novo Banco', 'Santander', 'BPI', 'ActivoBank'],
    soc: 'Segurança Social (cotisations sociales)',
    tax: 'Retenção IRS',
    cats: ['Assurance santé'],
    savings: ['Certificados de Aforro', 'PPR'],
    tz: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores']
  },
  GB: {
    en: { name: "United Kingdom", soc: "National Insurance", tax: "Income Tax (PAYE)" },
    de: { name: "Vereinigtes Königreich", soc: "National Insurance", tax: "Income Tax (PAYE)" },
    name: 'Royaume-Uni', cur: 'GBP', locale: 'en-GB',
    banks: ['Barclays', 'HSBC UK', 'Lloyds', 'NatWest', 'Santander UK', 'Nationwide', 'Monzo', 'Starling'],
    soc: 'National Insurance',
    tax: 'Income Tax (PAYE)',
    cats: ['Council Tax'],
    savings: ['ISA', 'Pension'],
    tz: ['Europe/London']
  },
  US: {
    en: { name: "United States", soc: "Social Security and Medicare (FICA)", tax: "Federal and state tax withheld" },
    de: { name: "Vereinigte Staaten", soc: "Social Security und Medicare (FICA)", tax: "Einbehaltene Bundes- und Staatssteuer" },
    name: 'États-Unis', cur: 'USD', locale: 'en-US',
    banks: ['Chase', 'Bank of America', 'Wells Fargo', 'Citi', 'Capital One', 'U.S. Bank', 'PNC', 'Ally'],
    soc: 'Social Security et Medicare (FICA)',
    tax: "Impôt fédéral et d'État retenu",
    cats: ['Assurance santé'],
    savings: ['401(k)', 'IRA'],
    tz: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Detroit']
  },
  MA: {
    en: { name: "Morocco", soc: "CNSS and AMO contributions", tax: "Income tax withheld at source" },
    de: { name: "Marokko", soc: "CNSS- und AMO-Beiträge", tax: "Einkommenssteuer an der Quelle" },
    name: 'Maroc', cur: 'MAD', locale: 'fr-MA',
    banks: ['Attijariwafa bank', 'Banque Populaire', 'Bank of Africa', 'CIH Bank', 'Crédit du Maroc', 'Al Barid Bank'],
    soc: 'Cotisations CNSS et AMO',
    tax: 'IR retenu à la source',
    cats: ['Assurance santé'],
    savings: ['Compte sur carnet'],
    tz: ['Africa/Casablanca']
  },
  TN: {
    en: { name: "Tunisia", soc: "CNSS contributions", tax: "IRPP withheld at source" },
    de: { name: "Tunesien", soc: "CNSS-Beiträge", tax: "IRPP an der Quelle" },
    name: 'Tunisie', cur: 'TND', locale: 'fr-TN',
    banks: ['BIAT', 'STB', 'BNA', 'Attijari bank', 'Amen Bank', 'UIB', 'La Poste Tunisienne'],
    soc: 'Cotisations CNSS',
    tax: 'IRPP retenu à la source',
    cats: ['Assurance santé'],
    savings: ["Compte d'épargne"],
    tz: ['Africa/Tunis']
  },
  SN: {
    en: { name: "Senegal", soc: "IPRES and CSS contributions", tax: "Income tax withheld" },
    de: { name: "Senegal", soc: "IPRES- und CSS-Beiträge", tax: "Einbehaltene Einkommenssteuer" },
    name: 'Sénégal', cur: 'XOF', locale: 'fr-SN',
    banks: ['CBAO', 'Ecobank', 'Banque Atlantique', 'BHS', 'Wave', 'Orange Money'],
    soc: 'Cotisations IPRES et CSS',
    tax: 'Impôt sur le revenu retenu',
    cats: ['Assurance santé'],
    savings: ["Compte d'épargne"],
    tz: ['Africa/Dakar']
  },
  CI: {
    en: { name: "Côte d'Ivoire", soc: "CNPS contributions", tax: "ITS (salary tax)" },
    de: { name: "Elfenbeinküste", soc: "CNPS-Beiträge", tax: "ITS (Lohnsteuer)" },
    name: "Côte d'Ivoire", cur: 'XOF', locale: 'fr-CI',
    banks: ['Ecobank', 'NSIA Banque', 'Banque Atlantique', 'SIB', 'Wave', 'Orange Money'],
    soc: 'Cotisations CNPS',
    tax: 'ITS (impôt sur traitements et salaires)',
    cats: ['Assurance santé'],
    savings: ["Compte d'épargne"],
    tz: ['Africa/Abidjan']
  },
  XX: {
    en: { name: "Other country", soc: "Social contributions", tax: "Tax withheld from salary" },
    de: { name: "Anderes Land", soc: "Sozialabzüge", tax: "Vom Lohn einbehaltene Steuer" },
    name: 'Autre pays', cur: 'EUR', locale: 'fr',
    banks: ['Revolut', 'Wise', 'N26'],
    soc: 'Cotisations sociales',
    tax: 'Impôt retenu sur le salaire',
    cats: [],
    savings: ['Compte épargne'],
    tz: []
  }
};

/* Devises proposées pour un compte. Les taux de la BCE couvrent toutes
   celles-ci sauf MAD, TND et XOF (XOF est calculé via sa parité fixe avec l'euro). */
window.BUDGET_CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP', 'CAD', 'MAD', 'TND', 'XOF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'AUD'];
window.BUDGET_ECB = ['AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR'];
