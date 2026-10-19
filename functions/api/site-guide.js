// Site Guide chat API — deterministic retrieval from evidence JSON.
// POST { message, page } → { reply }
// No Workers AI binding. Refuse dosing / injection / stacking server-side.
//
// Match other Pages Functions style: onRequestPost + onRequestOptions.

const DISCLAIMER =
  "Research use only. Not for human or animal consumption. Not medical advice.";

const REFUSAL =
  "I can't help with dosing, reconstitution, injection technique, stacking, or personal protocols — that needs a licensed clinician. I can share the research notes we have on file and point you to the catalog.";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

let EVIDENCE_CACHE = null;

const BUNDLED_EVIDENCE = {"compiled_at":"2026-09-16","tier_key":"A = approved drug / strong human RCTs · B = multiple human trials, mixed or non-US · C = limited human / Russian or small trials · D = preclinical / single-lineage / no combination data.","disclaimer":"Research use only. Not for human or animal consumption. Not medical advice.","site_map":{"home":"https://discountspeptides.com/","testing":"https://discountspeptides.com/testing.html","suppliers":"https://discountspeptides.com/suppliers.html","about":"https://discountspeptides.com/about.html"},"cards":[{"id":"glow","name":"GLOW","identity":"Market nickname for a three-peptide research blend, not a single molecule. Common label: GHK-Cu ~50 mg + BPC-157 ~10 mg + TB-500 ~10 mg (≈70 mg). Ratios vary by vendor; the name is not a pharmacopeial standard.","tier":"D for the blend. Component tiers differ (GHK-Cu topical human cosmetic data; BPC-157 mostly animal; TB-500 fragment thin; parent thymosin β4 has some wound/ophthalmic trials).","what_exists":"Separate literatures for each peptide. No published controlled study of GHK-Cu + BPC-157 + TB-500 together in any species.","regulatory":"Not FDA-approved. BPC-157 and related peptides have been in FDA compounding / Category 2 discussions; PCAC votes are non-binding until rulemaking.","caveats":"Synergy is inferred. Copper from GHK-Cu could affect other peptides; not studied. Injectable GHK-Cu is not the same evidence base as topical cosmetic GHK-Cu. Confirm each component on the lot COA.","sources":"Pickart & Margolina, Int J Mol Sci 2018 (PMID 29986520); HSS Journal 2025 BPC-157 systematic review; thymosin β4 Phase 2 wound / RGN-259 ophthalmic work (parent protein, not the fragment); FDA PCAC / NYT / Science coverage of 2026 compounding votes.","catalog_keys":"Catalog keys seen on this site (examples; **live catalog always wins**): `GLOW Blend (GHK-Cu/BPC-157/TB-500) | Vial | 70mg` — Alpha Peptides, Midwest Peptide, American Peptides, Offline Peptides. Not listed under Royal Peptides in the current live snapshot. Related: Wolverine (BPC-157/TB-500), KLOW, GHK-Cu, BPC-157, TB-500, KPV as singles."},{"id":"klow","name":"KLOW","identity":"GLOW plus KPV. Common label: GHK-Cu ~50 mg + BPC-157 ~10 mg + TB-500 ~10 mg + KPV ~10 mg (≈80 mg).","tier":"D for the blend.","what_exists":"Same three literatures as GLOW, plus KPV mouse colitis / NF-κB work. Zero peer-reviewed studies of the four-peptide combination. Closest published combo is a small uncontrolled knee series of BPC-157 ± thymosin β4 — not KLOW.","regulatory":"Not approved. Same compounding caveats as the components.","caveats":"Fixed 5:1:1:1 ratio may not match doses used in any single-agent study. Half-lives differ (BPC-157 short in animals; tripeptides clear fast). WADA lists thymosin β4 / TB-500 (S2).","sources":"Dalmasso et al., Gastroenterology 2008 (PMID 18061177) — PepT1-mediated KPV uptake, DSS/TNBS colitis in mice; Kelly / Getting α-MSH fragment NF-κB papers; same GHK-Cu / BPC-157 / Tβ4 sources as GLOW.","catalog_keys":"Catalog keys (examples; **live catalog always wins**): `KLOW (BPC-157/TB-500/GHK-Cu/KPV) | Vial | 80mg` (some vendors also key `… | Vial | 10/10/50/10mg`) — Alpha Peptides, Midwest Peptide, American Peptides, Offline Peptides. Not listed under Royal Peptides in the current live snapshot. Related: GLOW, Wolverine, KPV, GHK-Cu / KPV nasal combos on some vendors."},{"id":"kpv","name":"KPV","identity":"Lys-Pro-Val, C-terminal tripeptide of α-MSH.","tier":"D (preclinical). Strong mechanism papers; no human efficacy trials in the file.","what_exists":"Inhibits NF-κB / MAPK; taken up via PepT1 in gut epithelium and immune cells; reduced colitis markers in DSS and TNBS mice.","regulatory":"Not approved. Appeared in 2026 PCAC compounding discussion with other research peptides.","sources":"PMID 18061177; related α-MSH fragment papers (PMID 16274845 and reviews).","formats":"vial, nasal, oral on some vendors."},{"id":"bpc-157","name":"BPC-157","identity":"Synthetic 15-aa gastric pentadecapeptide.","tier":"D for human use; large preclinical file, almost all from one research lineage plus limited independent mechanism work.","what_exists":"Rodent tendon, muscle, gut, vascular models. 2025 HSS Journal review: nearly all preclinical; one small retrospective human series. FDA staff have argued chemical characterization and human safety data are insufficient; 2026 PCAC voted to recommend 503A listing (non-binding).","caveats":"Not FDA-approved. Gray-market quality issues documented in general peptide testing literature. No adequate RCTs.","sources":"HSS Journal 2025 systematic review; FDA PCAC briefing / NYT 23 Jul 2026; Science / MedPage Today on the same meeting.","formats":"vial, nasal, oral, blends (Wolverine, GLOW, KLOW)."},{"id":"tb-500","name":"TB-500","identity":"Synthetic fragment (often Ac-LKKTETQ) of thymosin β4 — not the full 43-aa protein.","tier":"D for the fragment. Parent Tβ4 has more human wound / ophthalmic data.","what_exists":"Animal migration / angiogenesis models. Phase 2 topical Tβ4 wound data and RGN-259 ophthalmic trials apply to the parent protein.","caveats":"Do not treat Tβ4 trial results as TB-500 results. WADA S2. PCAC discussed injectable TB-500 in 2026.","sources":"Tβ4 wound / Sosne ophthalmic literature; FDA staff notes on scarce human data for the fragment.","formats":"vial; in Wolverine / GLOW / KLOW."},{"id":"ghk-cu","name":"GHK-Cu","identity":"Gly-His-Lys copper(II) complex; endogenous tripeptide.","tier":"B–C topical cosmetic; D for injectable / systemic claims.","what_exists":"Extensive in-vitro gene-expression work (~thousands of genes). Small IRB cosmetic trials of topical GHK-Cu (wrinkle / collagen histology). Plasma levels decline with age in observational work.","caveats":"Topical ≠ injectable. Copper load and peptide stability in multi-peptide vials are not characterized in the file.","sources":"PMID 29986520; Pickart historical isolation work; topical cosmetic trials cited in evidence reviews.","formats":"vial, nasal, oral on some vendors; dominant mass in GLOW/KLOW."},{"id":"selank","name":"Selank","identity":"Heptapeptide tuftsin analog (Thr-Lys-Pro-Arg-Pro-Gly-Pro).","tier":"C. Russian anxiolytic registration; limited English-language RCTs.","what_exists":"GAD clinical reports; GABA allosteric / gene-expression work; rodent memory models.","caveats":"Thin Western replication.","sources":"PMID 31625062, 30255741, 26924987.","formats":"vial, nasal, Selank/Semax combo."},{"id":"semax","name":"Semax","identity":"ACTH(4-10) analog Met-Glu-His-Phe-Pro-Gly-Pro.","tier":"C. Russian approval for stroke / cognition; BDNF work in animals; limited human.","sources":"PMID 16635254, 34201112.","formats":"vial, nasal, combo with Selank."},{"id":"epitalon-epithalon","name":"Epitalon (Epithalon)","identity":"Ala-Glu-Asp-Gly pineal tetrapeptide.","tier":"D. Cell/rodent telomerase and lifespan work mostly from one Russian group; 2025 Brunel in-vitro confirmation of hTERT upregulation also noted ALT in cancer lines.","sources":"PMID 40908429; Int J Mol Sci 2025 overview PMID 40141333.","formats":"vial, nasal, oral on some vendors."},{"id":"thymosin-alpha-1-thymalfasin","name":"Thymosin Alpha-1 (thymalfasin)","identity":"28-aa thymic peptide.","tier":"B. Many human trials (hepatitis, immune adjunct, mixed sepsis/COVID). Approved in numerous countries; not broadly FDA-approved. US compounding restricted for most uses since ~2023. Large 2025 sepsis trial (TESTS) negative on 28-day mortality.","sources":"PMID 38308608; TESTS trial coverage; hepatitis meta-analyses.","formats":"vial, nasal, oral on some vendors."},{"id":"ss-31-elamipretide","name":"SS-31 (elamipretide)","identity":"Mitochondria-targeted tetrapeptide (Szeto-Schiller 31).","tier":"B for Barth syndrome (FDA accelerated approval 2025, FORZINITY); mixed/failed for primary mitochondrial myopathy and several heart trials. Strong aged-mouse muscle energetics data.","caveats":"Do not generalize Barth approval to research-chemical vials sold for other uses.","formats":"vial, nasal, oral on some vendors."},{"id":"melanotan-2","name":"Melanotan 2","identity":"Non-selective melanocortin agonist.","tier":"C for pigmentation / erectile signals in tiny early Arizona trials; safety file is case reports (priapism, hypertension, naevi change, melanoma signal unresolved). Not approved anywhere. PT-141 is the related approved sexual-dysfunction drug (different product).","sources":"Dorr / Wessells early trials; Clinical Toxicology case-series reviews.","formats":"vial on some vendors."},{"id":"ll-37","name":"LL-37","identity":"Human cathelicidin fragment.","tier":"C. Broad antimicrobial mechanism; HEAL LL-37 Phase 2b venous-ulcer RCT missed primary endpoint; subgroup signal in large ulcers.","sources":"PMID 34687253.","formats":"vial."},{"id":"vip-aviptadil","name":"VIP (aviptadil)","identity":"28-aa neuropeptide.","tier":"C. Small PAH open study; COVID respiratory-failure RCT missed primary endpoint. Extremely short plasma half-life.","sources":"PMID 12727925, 36044317.","formats":"vial."},{"id":"hcg","name":"hCG","identity":"Glycoprotein hormone. FDA-approved since 1967 for ovulation trigger and labeled male hypogonadism / cryptorchidism uses.","tier":"A for labeled fertility uses. Not approved for weight loss.","formats":"IU vials on some vendors. Research-chemical lots are not the licensed drug."},{"id":"mazdutide","name":"Mazdutide","identity":"GLP-1 / glucagon dual agonist (Innovent). Phase 3 weight and T2D data in Chinese adults; NMPA approval in China reported; not FDA-approved.","tier":"B (strong RCTs, limited geography).","sources":"PMID 41407859, 40421736."},{"id":"slu-pp-332","name":"SLU-PP-332","identity":"Small-molecule ERR pan-agonist, not a peptide.","tier":"D. Mouse endurance / metabolic papers only. No human trials in the file.","sources":"Billon / Burris lab 2023 onward."},{"id":"hgh-fragment-176-191","name":"HGH fragment 176-191","identity":"C-terminal GH fragment. Preclinical lipolysis from one group; stabilized analog AOD-9604 failed large human weight-loss trials.","tier":"D.","sources":"PMID 10950816; AOD-9604 Phase 2B reports."},{"id":"cardiogen","name":"Cardiogen","identity":"AEDR tetrapeptide, Khavinson cardiac bioregulator.","tier":"D. Organotypic / rodent work from one lineage. No human trials in the file."},{"id":"thymalin","name":"Thymalin","identity":"Bovine thymic peptide mixture (not the same as thymosin α1).","tier":"D–C. Long Russian observational elderly cohorts; no Western RCTs.","sources":"Khavinson / Morozov 2002–2003."},{"id":"ahk-cu","name":"AHK-Cu","identity":"Ala-His-Lys-copper. One 2007 ex-vivo human follicle paper (PMID 17703734). No in-vivo human trials. Do not recycle GHK-Cu claims."},{"id":"ghrp-2-pralmorelin","name":"GHRP-2 (pralmorelin)","identity":"Ghrelin-receptor GH secretagogue. Japanese diagnostic GH-stimulation data; not FDA-approved.","tier":"C for diagnostic use in that program."},{"id":"ace-031","name":"ACE-031","identity":"Soluble ActRIIB-Fc myostatin-pathway blocker.","tier":"C early human (lean mass after single dose); DMD trial stopped for vascular AEs (epistaxis, telangiectasia). Development halted."},{"id":"aicar","name":"AICAR","identity":"AMPK-activating nucleoside, not a peptide. Mouse “exercise mimetic” data; WADA-prohibited. Limited human."},{"id":"oxytocin","name":"Oxytocin","identity":"Nonapeptide. FDA-approved for labor induction and postpartum hemorrhage.","tier":"A for labeled obstetric uses. Intranasal / obesity RCTs mixed (one 8-week obesity RCT no weight change). Research vials are not the licensed drug product."},{"id":"melatonin","name":"Melatonin","identity":"Pineal hormone; US dietary supplement, not an FDA-approved drug (agonists ramelteon / tasimelteon are).","tier":"B for jet lag and modest sleep-onset latency in meta-analyses.","formats":"some vendors list melatonin packs; quality varies in the supplement market."},{"id":"other-catalog-notes","name":"Other catalog notes","notes":"- Semaglutide / tirzepatide / retatrutide: approved or late-stage incretins when they are the licensed product. Research-chemical vials are not those products. Do not imply interchangeability. - Wolverine blend: BPC-157 + TB-500 only. Same “no combination trial” rule. - Semax + Selank combos: two Russian nootropics in one vial; no combination RCT in the file."},{"id":"quality-testing","name":"Quality / testing","identity":"COA and vendor-testing literacy for this site.","what_exists":"A COA can show HPLC purity, MS identity, sometimes content, sometimes endotoxin / metals / sterility. A COA cannot show that the material is safe or effective in people. Ask for the COA that matches the lot number, with a named laboratory and a date. Vendor testing claims on this site are taken from each vendor’s own published material and grouped by how far an outsider could check them.","caveats":"A COA cannot show that the material is safe or effective in people."}],"aliases":{"glow":"glow","klow":"klow","kpv":"kpv","bpc-157":"bpc-157","tb-500":"tb-500","ghk-cu":"ghk-cu","selank":"selank","semax":"semax","epitalon (epithalon)":"epitalon-epithalon","epithalon":"epitalon-epithalon","epitalon":"epitalon-epithalon","thymosin alpha-1 (thymalfasin)":"thymosin-alpha-1-thymalfasin","thymalfasin":"thymosin-alpha-1-thymalfasin","thymosin alpha-1":"thymosin-alpha-1-thymalfasin","ss-31 (elamipretide)":"ss-31-elamipretide","elamipretide":"ss-31-elamipretide","ss-31":"ss-31-elamipretide","melanotan 2":"melanotan-2","ll-37":"ll-37","vip (aviptadil)":"vip-aviptadil","aviptadil":"vip-aviptadil","vip":"vip-aviptadil","hcg":"hcg","mazdutide":"mazdutide","slu-pp-332":"slu-pp-332","hgh fragment 176-191":"hgh-fragment-176-191","cardiogen":"cardiogen","thymalin":"thymalin","ahk-cu":"ahk-cu","ghrp-2 (pralmorelin)":"ghrp-2-pralmorelin","pralmorelin":"ghrp-2-pralmorelin","ghrp-2":"ghrp-2-pralmorelin","ace-031":"ace-031","aicar":"aicar","oxytocin":"oxytocin","melatonin":"melatonin","other catalog notes":"other-catalog-notes","quality / testing talking points (from testing.html)":"quality-testing","from testing.html":"quality-testing","quality / testing talking points":"quality-testing","glow blend":"glow","wolverine":"other-catalog-notes","tb500":"tb-500","tb 500":"tb-500","bpc157":"bpc-157","bpc 157":"bpc-157","ghk cu":"ghk-cu","ghkcu":"ghk-cu","ta1":"thymosin-alpha-1-thymalfasin","ss31":"ss-31-elamipretide","melanotan":"melanotan-2","melanotan ii":"melanotan-2","melanotan-2":"melanotan-2","mt2":"melanotan-2","ll37":"ll-37","aod-9604":"hgh-fragment-176-191","hgh fragment":"hgh-fragment-176-191","176-191":"hgh-fragment-176-191","ghrp2":"ghrp-2-pralmorelin","coa":"quality-testing","testing":"quality-testing","quality":"quality-testing","coa prove":"quality-testing"},"topics":{"incretin-metabolic":{"label":"incretin & metabolic-pathway compounds","phrases":["incretin","glp-1 agonist","gip","amylin","metabolic pathway"],"evidence_ids":["mazdutide","hgh-fragment-176-191","slu-pp-332","aicar","other-catalog-notes"],"catalog_names":["AOD-9604","SLU-PP-332","GLP-1 (Semaglutide)","Semaglutide","Tirzepatide","Retatrutide","Cagrilintide","5-Amino-1MQ"],"framing":"Compounds this site files by compound class (incretin and metabolic-pathway). Catalog grouping only — research use only, not for human or animal use. Research-chemical incretin vials are not licensed drug products."},"thymosin-fragments":{"label":"thymosin, BPC-157 & peptide fragments","phrases":["thymosin","peptide fragment","pentadecapeptide","cathelicidin","thymic"],"evidence_ids":["bpc-157","tb-500","glow","klow","ll-37","ghk-cu"],"catalog_names":["BPC-157","TB-500","GLOW Blend (GHK-Cu/BPC-157/TB-500)","KLOW (BPC-157/TB-500/GHK-Cu/KPV)","Wolverine (BPC-157/TB-500 blend)","BPC-157 / TB-500 blend","LL-37","GHK-Cu (Copper Peptide)","KPV","Thymosin Alpha-1","Thymalin"],"framing":"Compounds this site files by compound class (thymosin fragments, BPC-157, peptide fragments). Catalog grouping only — research use only, not for human or animal use. Blends have no combination studies in our file."},"neuropeptide":{"label":"neuropeptide analogues","phrases":["neuropeptide","neuropeptide analogue","acth fragment","tuftsin"],"evidence_ids":["semax","selank"],"catalog_names":["Semax","Selank","Selank / Semax combo","Dihexa","Pinealon"],"framing":"Compounds this site files by compound class (neuropeptide analogues). Catalog grouping only — research use only, not for human or animal use."},"mitochondria":{"label":"mitochondrial-derived peptides","phrases":["mitochondria","mitochondrial","mitochondrial-derived peptide"],"evidence_ids":["ss-31-elamipretide","slu-pp-332","aicar"],"catalog_names":["SS-31 / Elamipretide","SLU-PP-332","MOTS-C","Humanin","NAD+","5-Amino-1MQ"],"framing":"Compounds this site files by compound class (mitochondrial-derived peptides and cofactors). Catalog grouping only — research use only, not for human or animal use."},"melanocortin-hpg":{"label":"melanocortin & HPG-axis compounds","phrases":["melanocortin","gonadotropin","gnrh","kisspeptin","hpg axis","pt-141","pt141","bremelanotide"],"evidence_ids":["melanotan-2"],"catalog_names":["PT-141 (Bremelanotide)","Melanotan II","Melanotan I","Kisspeptin","Gonadorelin"],"framing":"Compounds this site files by compound class (melanocortin-receptor agonists, HPG-axis peptides). Catalog grouping only — research use only, not for human or animal use. PT-141 (bremelanotide) is a different compound from Melanotan 2."},"growth-hormone":{"label":"GH secretagogues / GHRH","phrases":["growth hormone","gh secretagogue","ghrh","sermorelin","ipamorelin","cjc","hexarelin","ghrp"],"evidence_ids":["ghrp-2-pralmorelin"],"catalog_names":["CJC-1295","CJC-1295 with DAC","CJC-1295 / Ipamorelin combo","Ipamorelin","Sermorelin","GHRP-2","GHRP-6","Hexarelin","Tesamorelin","Tesamorelin / Ipamorelin combo"],"framing":"Compounds this site files by compound class (GH secretagogues, GHRH analogues). Catalog grouping only — research use only, not for human or animal use."}},"topic_phrases":{"incretin":"incretin-metabolic","glp-1 agonist":"incretin-metabolic","gip":"incretin-metabolic","amylin":"incretin-metabolic","metabolic pathway":"incretin-metabolic","thymosin":"thymosin-fragments","peptide fragment":"thymosin-fragments","pentadecapeptide":"thymosin-fragments","cathelicidin":"thymosin-fragments","thymic":"thymosin-fragments","neuropeptide":"neuropeptide","neuropeptide analogue":"neuropeptide","acth fragment":"neuropeptide","tuftsin":"neuropeptide","mitochondria":"mitochondria","mitochondrial":"mitochondria","mitochondrial-derived peptide":"mitochondria","melanocortin":"melanocortin-hpg","gonadotropin":"melanocortin-hpg","gnrh":"melanocortin-hpg","kisspeptin":"melanocortin-hpg","hpg axis":"melanocortin-hpg","pt-141":"melanocortin-hpg","pt141":"melanocortin-hpg","bremelanotide":"melanocortin-hpg","growth hormone":"growth-hormone","gh secretagogue":"growth-hormone","ghrh":"growth-hormone","sermorelin":"growth-hormone","ipamorelin":"growth-hormone","cjc":"growth-hormone","hexarelin":"growth-hormone","ghrp":"growth-hormone"}};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const message = String(body?.message || "").trim().slice(0, 500);
  const page = normalizePage(body?.page);

  if (!message) {
    return json({ reply: welcomeFor(page) });
  }

  const evidence = await loadEvidence(request);
  const lower = message.toLowerCase();

  if (isRefusal(lower)) {
    const card = findCard(evidence, lower);
    let reply = REFUSAL;
    if (card && card.id !== "quality-testing" && card.id !== "other-catalog-notes") {
      reply +=
        "\n\nOn file for " +
        card.name +
        ": " +
        oneLine(card.identity) +
        " Tier: " +
        oneLine(card.tier || "not graded in file") +
        ".";
      reply += "\nCompare listings: " + evidence.site_map.home;
    }
    return json({ reply });
  }

  if (/ask about a (peptide|vendor)/.test(lower)) {
    return json({
      reply: /vendor/.test(lower)
        ? "Name a vendor on this site and I’ll stick to catalog facts, or browse: " +
          evidence.site_map.suppliers
        : "Name a peptide and I’ll pull the evidence card we have on file.",
    });
  }

  // Navigation helpers
  if (wantsNav(lower, "testing") || /what does testing mean|coa prove|vendor testing tiers|see testing/.test(lower)) {
    if (/coa|prove|can.?t prove|cannot prove/.test(lower) || /what can a coa/.test(lower)) {
      return json({ reply: formatQuality(evidence) });
    }
    if (/tier/.test(lower)) {
      return json({
        reply:
          "Vendor testing claims on this site come from each vendor’s own published material and are grouped by how far an outsider could check them (lot-matched COA with a named lab preferred). See the full tiers on the testing page: " +
          evidence.site_map.testing +
          "\n\n" +
          DISCLAIMER,
      });
    }
    return json({
      reply:
        "Testing & quality notes live here: " +
        evidence.site_map.testing +
        "\n\nA COA can show HPLC purity, MS identity, sometimes content / endotoxin / metals / sterility. It cannot show safety or efficacy in people. Prefer a lot-matched COA with a named laboratory and date.\n\n" +
        DISCLAIMER,
    });
  }

  if (wantsNav(lower, "suppliers") || /go to suppliers|list suppliers|who('?s| is) on the site/.test(lower)) {
    if (/list suppliers|who('?s| is) on|which vendors|list vendors/.test(lower)) {
      const { vendors, fromConfig } = await listVendors(request);
      if (vendors.length) {
        return json({
          reply:
            (fromConfig ? "Suppliers listed on this site (" + vendors.length + "): " : "Suppliers currently on the live catalog snapshot: ") +
            vendors.join(", ") +
            ".\nMore context: " +
            evidence.site_map.suppliers +
            " · Testing tiers: " +
            evidence.site_map.testing +
            " · Prices: " +
            evidence.site_map.home +
            "\n\nCatalog facts only — check each vendor’s own site for shipping/payment.",
        });
      }
    }
    return json({
      reply:
        "Supplier page: " +
        evidence.site_map.suppliers +
        " · Testing: " +
        evidence.site_map.testing +
        " · Price comparison: " +
        evidence.site_map.home,
    });
  }

  if (
    wantsNav(lower, "home") ||
    /back to (price|peptides|home|catalog)|price list|compare prices|find a peptide/.test(lower)
  ) {
    if (/compare prices|price/.test(lower) && !/find a peptide/.test(lower)) {
      const card = findCard(evidence, lower);
      if (card && card.id !== "quality-testing") {
        const priceBlock = await formatPrices(request, card);
        return json({
          reply:
            priceBlock +
            "\nFull comparison table: " +
            evidence.site_map.home +
            "\n\n" +
            DISCLAIMER,
        });
      }
      return json({
        reply:
          "Live prices are on the comparison table (home). Name a peptide (e.g. BPC-157 10mg vial) and I can pull matching rows from the catalog snapshot, or open: " +
          evidence.site_map.home,
      });
    }
    if (/find a peptide/.test(lower)) {
      return json({
        reply:
          "Tell me a compound name (e.g. GLOW, BPC-157, Selank) or a compound class (e.g. incretin analogues, GH secretagogues, neuropeptide analogues) and I’ll point you to matching catalog entries + evidence notes: " +
          evidence.site_map.home,
      });
    }
    return json({
      reply: "Price comparison / home: " + evidence.site_map.home,
    });
  }

  // Price compare intent with a named compound
  if (/price|cost|how much|cheapest|compare/.test(lower)) {
    const card = findCard(evidence, lower);
    const priceBlock = await formatPrices(request, card, lower);
    return json({
      reply: priceBlock + "\n\n" + DISCLAIMER,
    });
  }

  // Evidence card lookup
  const card = findCard(evidence, lower);
  if (card) {
    if (card.id === "quality-testing") {
      return json({ reply: formatQuality(evidence) });
    }
    if (card.id === "other-catalog-notes") {
      return json({
        reply:
          formatOtherNotes(card) +
          "\n\nCatalog: " +
          evidence.site_map.home +
          "\n\n" +
          DISCLAIMER,
      });
    }
    const priceHint = await formatPrices(request, card, lower, true);
    return json({
      reply: formatCard(card, evidence) + "\n\n" + priceHint + "\n\n" + DISCLAIMER,
    });
  }

  // Shelf browse by compound class or category name — after named-compound miss
  const topic = findTopic(lower);
  if (topic) {
    return json({ reply: await formatTopic(request, evidence, topic) });
  }

  // Health goal / use (e.g. "something for fat loss") — no product mapping
  if (GOAL_RE.test(lower)) {
    return json({ reply: goalReply(evidence) });
  }

  // Out of file
  return json({
    reply:
      "That compound isn’t in our evidence file, so I won’t invent studies or claims. If it’s on the live catalog you can still compare listings here: " +
      evidence.site_map.home +
      " · Testing: " +
      evidence.site_map.testing +
      "\n\n" +
      DISCLAIMER,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

function normalizePage(page) {
  const p = String(page || "").toLowerCase();
  if (p.includes("testing")) return "testing";
  if (p.includes("supplier")) return "suppliers";
  return "home";
}

function welcomeFor(page) {
  if (page === "testing") {
    return "You’re on testing — COA literacy (what it shows and doesn’t), this site’s vendor tiers, or research notes for a named peptide.";
  }
  if (page === "suppliers") {
    return "You’re on suppliers — who’s listed, shipping/payment from our notes, or links to testing and the price list. Facts only, no hype.";
  }
  return "Hi — browse a catalog shelf, compare prices, or ask about a named peptide. Research use only; no dosing or medical advice.";
}

function isRefusal(lower) {
  return /\b(dos(e|ing|es)|reconstitut|inject(ion|ing|able)? technique|how (do|would|should) i (inject|pin|reconstitute)|syringe|iu\b|mcg\/kg|mg\/kg|stack(ing)?|cycle length|what dose|dose for my|for my (knee|shoulder|injury))\b/.test(
    lower
  );
}

function wantsNav(lower, target) {
  if (target === "testing") return /\btesting\.html\b|\btesting page\b|\bwhat does testing|\bsee testing|\bcoa\b|\bquality tier/.test(lower);
  if (target === "suppliers") return /\bsuppliers?\.html\b|\bsuppliers? page\b|\bgo to suppliers\b|\blist suppliers\b/.test(lower);
  if (target === "home") return /\bindex\.html\b|\bback to (price|peptides|home|catalog)\b|\bprice list\b/.test(lower);
  return false;
}

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

async function loadEvidence(request) {
  if (EVIDENCE_CACHE) return EVIDENCE_CACHE;
  // Prefer live static file (keeps data/site-guide-evidence.json editable without
  // redeploying function logic); fall back to bundled copy.
  try {
    const url = new URL("/data/site-guide-evidence.json", request.url);
    const res = await fetch(url.toString());
    if (res.ok) {
      EVIDENCE_CACHE = await res.json();
      return EVIDENCE_CACHE;
    }
  } catch (_) {}
  EVIDENCE_CACHE = BUNDLED_EVIDENCE;
  return EVIDENCE_CACHE;
}



// Mirror of home-page CATEGORIES — topic browse lists these and deep-links via ?q= / ?category=
const SITE_CATEGORIES = {
  "Incretin & Metabolic-Pathway Compounds": {
    "desc": "GLP-1/GIP/glucagon receptor agonists, amylin analogues, and other compounds catalogued for metabolic-pathway research.",
    "peptides": [
      "5-Amino-1MQ",
      "AOD-9604",
      "Cagrilintide",
      "GLP-1 (Semaglutide)",
      "GLP-1 (Semaglutide) Oral Spray",
      "GLP-3 Triple / GLP-1 Blend",
      "Orforglipron",
      "Retatrutide",
      "Retatrutide / GLP-1 Blend",
      "SLU-PP-332",
      "Semaglutide",
      "Tesofensine",
      "Tirzepatide"
    ]
  },
  "GH Secretagogues & IGF-Axis Peptides": {
    "desc": "GHRH analogues, ghrelin-receptor agonists, IGF-1 analogues and related growth-factor research compounds.",
    "peptides": [
      "CJC-1295",
      "CJC-1295 / Ipamorelin combo",
      "CJC-1295 with DAC",
      "Follistatin-344",
      "GHRP-2",
      "GHRP-6",
      "Hexarelin",
      "IGF-1 LR3",
      "Ipamorelin",
      "MK-677 (Ibutamoren) / MK-2866 (Ostarine) combo",
      "Sermorelin",
      "Tesamorelin",
      "Tesamorelin / Ipamorelin combo"
    ]
  },
  "Mitochondrial Peptides, Bioregulators & Cofactors": {
    "desc": "Mitochondrial-derived peptides, short bioregulator peptides, and cofactors such as NAD+ and glutathione.",
    "peptides": [
      "Epitalon",
      "Epitalon / Thymulin combo",
      "FOXO4-DRI",
      "GHK-Cu (Copper Peptide)",
      "Glutathione",
      "Glutathione / Magnesium combo",
      "Humanin",
      "MOTS-C",
      "Methyl B12 (Methylcobalamin)",
      "NAD+",
      "SNAP-8",
      "SS-31 / Elamipretide",
      "Thymalin",
      "Vesugen"
    ]
  },
  "Melanocortin & HPG-Axis Compounds": {
    "desc": "Melanocortin-receptor agonists, GnRH/gonadotropin-axis peptides, oxytocin analogues and related compounds.",
    "peptides": [
      "Gonadorelin",
      "HCG (Human Chorionic Gonadotropin)",
      "Kisspeptin",
      "Melanotan I",
      "Melanotan II",
      "Oxytocin",
      "Oxytocin / Methylene Blue combo",
      "PT-141 (Bremelanotide)",
      "PT-141 / Oxytocin / Tesamorelin combo",
      "PT-141 / Oxytocin combo",
      "Sildenafil Citrate"
    ]
  },
  "Neuropeptide Analogues": {
    "desc": "Synthetic analogues of ACTH fragments, tuftsin, DSIP and other neuropeptides catalogued for neuroscience research.",
    "peptides": [
      "DSIP",
      "Dihexa",
      "Pinealon",
      "Selank",
      "Selank / Semax combo",
      "Semax"
    ]
  },
  "Thymosin, BPC-157 & Peptide Fragments": {
    "desc": "Thymosin fragments, the BPC-157 pentadecapeptide, α-MSH and cathelicidin fragments, VIP, and their blends.",
    "peptides": [
      "ARA-290 (Cibinetide)",
      "BPC-157",
      "BPC-157 / TB-500 blend",
      "BPC-157 / TB-500 combo",
      "GHK-Cu / KPV combo",
      "GLOW Blend (GHK-Cu/BPC-157/TB-500)",
      "KLOW (BPC-157/TB-500/GHK-Cu/KPV)",
      "KPV",
      "KPV / Thymosin Alpha-1 combo",
      "LL-37",
      "TB-500",
      "Thymosin Alpha-1",
      "VIP (Vasoactive Intestinal Peptide)",
      "Wolverine (BPC-157/TB-500 blend)"
    ]
  }
};

// Old category names (renamed Oct 2026) → current SITE_CATEGORIES keys, so a
// cached widget pill or old link still lands on the right shelf.
const LEGACY_CATEGORIES = {
  "Metabolic & Weight": "Incretin & Metabolic-Pathway Compounds",
  "Growth Hormone & Muscle": "GH Secretagogues & IGF-Axis Peptides",
  "Tissue Repair & Recovery": "Thymosin, BPC-157 & Peptide Fragments",
  "Sexual Health & Hormonal": "Melanocortin & HPG-Axis Compounds",
  "Cellular & Longevity": "Mitochondrial Peptides, Bioregulators & Cofactors",
  "Cognitive & Neurological": "Neuropeptide Analogues"
};

// Health goals and uses. The guide does not map these to products: a visitor
// asking for a goal gets pointed at compound classes instead (see goalReply).
const GOAL_RE = /\b(fat\s*loss|fatloss|weight(\s*loss|loss|\s*management)?|lose\s*weight|losing\s*weight|obes(e|ity)|body\s*fat|burn(ing)?\s*fat|slim(ming)?|lipolysis|recover(y|ing)?|heal(ing)?|injur(y|ies|ed)|wounds?|tendons?|joints?|rehab|post[-\s]?workout|muscles?|bulk(ing)?|body\s*composition|sleep|insomnia|jet\s*lag|jetlag|libido|erectile|sex(ual)?(\s*health)?|arousal|anti[-\s]?aging|aging|longevity|lifespan|telomeres?|immun(e|ity)|infections?|sepsis|tann?ing|wrinkles?|skin|hair(\s*growth)?|memory|focus|nootropics?|cognit(ive|ion)|anxiety|mood|depression|energy|endurance|stamina)\b/;

function findTopic(lower) {
  // Six site shelves, matched by compound-class words only (not health goals).
  // Named peptides are handled by findCard first.
  const topics = [
    {
      id: "thymosin_fragments",
      categoryKey: "Thymosin, BPC-157 & Peptide Fragments",
      match: /\b(thymosins?|thymic|peptide\s*fragments?|pentadecapeptide|cathelicidin)\b/,
    },
    {
      id: "incretin_metabolic",
      categoryKey: "Incretin & Metabolic-Pathway Compounds",
      match: /\b(incretins?|glp[-\s]?1\s*(receptor\s*)?agonists?|gip|amylin(\s*analogues?)?|metabolic[-\s]?pathway)\b/,
    },
    {
      id: "growth_hormone",
      categoryKey: "GH Secretagogues & IGF-Axis Peptides",
      match: /\b(growth\s*hormone|gh\s*secretagogues?|ghrh|sermorelin|ipamorelin|cjc[-\s]?1295|hexarelin|ghrp|secretagogues?|igf[-\s]?(1\s*)?axis)\b/,
    },
    {
      id: "neuropeptide",
      categoryKey: "Neuropeptide Analogues",
      match: /\b(neuropeptides?(\s*analogues?)?|acth\s*fragments?|tuftsin)\b/,
    },
    {
      id: "mitochondrial",
      categoryKey: "Mitochondrial Peptides, Bioregulators & Cofactors",
      match: /\b(mitochondri(a|al)|bioregulators?|cofactors?)\b/,
    },
    {
      id: "melanocortin_hpg",
      categoryKey: "Melanocortin & HPG-Axis Compounds",
      match: /\b(melanocortins?|hpg[-\s]?axis|gonadotropins?|gnrh|kisspeptin|pt[-\s]?141|bremelanotide)\b/,
    },
  ];
  // Exact category-name mentions (current or old names, e.g. a widget pill).
  const names = Object.keys(SITE_CATEGORIES).map((k) => [k, k]).concat(Object.entries(LEGACY_CATEGORIES));
  for (const [name, key] of names) {
    if (lower.includes(name.toLowerCase())) return shelfTopic(key);
  }
  for (const t of topics) {
    if (t.match.test(lower)) return shelfTopic(t.categoryKey);
  }
  return null;
}

function shelfTopic(key) {
  return {
    id: "shelf_" + key,
    categoryKey: key,
    title: "Catalog shelf: " + key,
    blurb:
      "Compounds this site files under " +
      key +
      " (grouped by compound class). Catalog grouping only — research use only, not for human or animal use, and not medical advice.",
  };
}

function goalReply(evidence) {
  const home = (evidence.site_map && evidence.site_map.home) || "https://discountspeptides.com/";
  const base = home.replace(/\/?$/, "/");
  const lines = [
    "I don’t match health goals or uses to compounds. Everything listed here is sold for laboratory research only, not for human or animal use.",
    "Name a compound and I’ll pull the evidence card we have on file, or browse the catalog by compound class:",
  ];
  for (const key of Object.keys(SITE_CATEGORIES)) {
    lines.push("• " + key + " — " + base + "?category=" + encodeURIComponent(key));
  }
  lines.push("");
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

async function formatTopic(request, evidence, topic) {
  const home = (evidence.site_map && evidence.site_map.home) || "https://discountspeptides.com/";
  const base = home.replace(/\/?$/, "/");
  const lines = [];
  lines.push(topic.title + ".");
  lines.push(topic.blurb);

  let names = [];
  if (topic.categoryKey && SITE_CATEGORIES[topic.categoryKey]) {
    names = SITE_CATEGORIES[topic.categoryKey].peptides.slice();
  } else if (topic.compounds && topic.compounds.length) {
    names = topic.compounds.slice();
  }

  const data = await loadPrices(request);
  const catalogBlob = data?.results
    ? JSON.stringify(data.results).toLowerCase()
    : "";

  // Prefer names that appear in live_prices; keep others marked.
  const ranked = [];
  for (const name of names) {
    const needle = name.toLowerCase().split("/")[0].trim();
    const onCatalog =
      !catalogBlob ||
      catalogBlob.includes(needle) ||
      catalogBlob.includes(needle.replace(/[^a-z0-9+]/g, ""));
    ranked.push({ name, onCatalog: Boolean(onCatalog) });
  }
  if (catalogBlob) {
    ranked.sort((a, b) => Number(b.onCatalog) - Number(a.onCatalog));
  }

  lines.push("On this site, start here:");
  for (const c of ranked) {
    const qUrl = base + "?q=" + encodeURIComponent(c.name);
    let bit = "• " + c.name + " — " + qUrl;
    if (catalogBlob && !c.onCatalog) {
      bit += " (check catalog — may not be in current live snapshot)";
    }
    lines.push(bit);
  }

  if (topic.categoryKey) {
    const catUrl = base + "?category=" + encodeURIComponent(topic.categoryKey);
    lines.push("Open the full category filter: " + catUrl);
  } else {
    lines.push("Open the price list: " + home);
  }
  lines.push("Or name one compound and I’ll pull the evidence card we have on file.");
  lines.push("");
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

function findCard(evidence, lower) {
  const aliases = evidence.aliases || {};
  const cards = evidence.cards || [];
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

  // Longest alias match wins
  let best = null;
  let bestLen = 0;
  for (const [alias, id] of Object.entries(aliases)) {
    if (alias.length > bestLen && lower.includes(alias)) {
      best = byId[id];
      bestLen = alias.length;
    }
  }
  if (best) return best;

  for (const c of cards) {
    const name = (c.name || "").toLowerCase();
    if (name && lower.includes(name)) return c;
    const id = (c.id || "").replace(/-/g, " ");
    if (id && lower.includes(id)) return c;
  }
  return null;
}

function formatCard(card, evidence) {
  const lines = [];
  lines.push(card.name + " — " + oneLine(card.identity || "see file."));
  if (card.tier) lines.push("Evidence tier: " + oneLine(card.tier));
  if (card.what_exists) lines.push("What exists: " + oneLine(card.what_exists));
  if (card.regulatory) lines.push("Regulatory: " + oneLine(card.regulatory));
  if (card.caveats) lines.push("Caveats: " + oneLine(card.caveats));
  if (card.sources) lines.push("Sources (from file): " + oneLine(card.sources));
  if (card.formats) lines.push("Formats on site: " + oneLine(card.formats));
  if (card.catalog_keys) lines.push("Catalog keys noted in file: " + oneLine(card.catalog_keys) + " (prefer live catalog if they differ).");
  lines.push(
    "Site guide: prices " +
      evidence.site_map.home +
      " · testing " +
      evidence.site_map.testing +
      " · suppliers " +
      evidence.site_map.suppliers
  );
  return lines.join("\n");
}

function formatQuality(evidence) {
  return (
    "What a COA can prove: HPLC purity, MS identity, sometimes content / fill weight, sometimes endotoxin / metals / sterility.\n" +
    "What it cannot prove: safety or efficacy in people.\n" +
    "Prefer a COA that matches the lot number, with a named laboratory and a date.\n" +
    "Vendor testing claims on this site are taken from each vendor’s own published material and grouped by how far an outsider could check them.\n" +
    "Full page: " +
    evidence.site_map.testing +
    "\n\n" +
    DISCLAIMER
  );
}

function formatOtherNotes(card) {
  return oneLine(card.notes || card.identity || "See evidence file for blend / incretin notes.") +
    " GLOW and KLOW have no published combination trials. Wolverine = BPC-157 + TB-500 only. Research-chemical incretin vials are not licensed drug products.";
}

async function loadPrices(request) {
  try {
    const url = new URL("/data/live_prices.json", request.url);
    const res = await fetch(url.toString());
    if (res.ok) return await res.json();
  } catch (_) {}
  return null;
}

// Same source as the suppliers page: every vendor in vendor_config.json
// (keys starting with "_" are not vendors; vendors with "hidden": true are
// not shown on the site), sorted by name. Falls back to the live price file
// only if the config can't be read.
async function listVendors(request) {
  try {
    const res = await fetch(new URL("/vendor_config.json", request.url).toString());
    if (res.ok) {
      const cfg = await res.json();
      const names = Object.keys(cfg || {}).filter((k) => !k.startsWith("_") && !(cfg[k] && cfg[k].hidden === true)).sort();
      if (names.length) return { vendors: names, fromConfig: true };
    }
  } catch (_) {}
  const data = await loadPrices(request);
  return { vendors: data?.results ? Object.keys(data.results) : [], fromConfig: false };
}

async function formatPrices(request, card, lower = "", brief = false) {
  const data = await loadPrices(request);
  const home = "https://discountspeptides.com/";
  if (!data?.results) {
    return (
      "Live prices aren’t readable from this function right now — use the comparison table on the home page: " +
      home
    );
  }

  const checked = data.checked_at || "unknown";
  const needles = buildPriceNeedles(card, lower);
  const rows = [];

  for (const [vendor, products] of Object.entries(data.results)) {
    for (const [key, info] of Object.entries(products || {})) {
      const k = key.toLowerCase();
      if (!needles.some((n) => k.includes(n))) continue;
      const price = info?.price;
      const priceStr =
        price == null || Number.isNaN(Number(price))
          ? "no confident price"
          : "$" + Number(price).toFixed(2);
      rows.push({ vendor, key, priceStr, price: price == null ? null : Number(price) });
    }
  }

  if (!rows.length) {
    return (
      "No matching rows in the live catalog snapshot (checked_at " +
      checked +
      "). See the full table: " +
      home
    );
  }

  rows.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });

  const limit = brief ? 5 : 12;
  const lines = rows.slice(0, limit).map((r) => "• " + r.vendor + " — " + r.key + " — " + r.priceStr);
  let out =
    "Live catalog matches (checked_at " +
    checked +
    "):\n" +
    lines.join("\n");
  if (rows.length > limit) out += "\n…and " + (rows.length - limit) + " more on " + home;
  else out += "\nFull table: " + home;
  return out;
}

function buildPriceNeedles(card, lower) {
  const needles = [];
  if (card && card.name) {
    const base = card.name.split("(")[0].trim().toLowerCase();
    needles.push(base);
    if (base === "glow") needles.push("glow blend");
    if (base === "tb-500") needles.push("tb-500", "tb500");
  }
  // pull quoted-ish tokens from message
  const m = lower.match(/\b(bpc-?157|tb-?500|ghk-?cu|kpv|glow|klow|selank|semax|epitalon|epithalon|ss-?31|ll-?37|melanotan|kpv|wolverine)\b/i);
  if (m) needles.push(m[1].toLowerCase().replace(/(\d)/, "-$1").replace(/--/, "-"));
  // normalize bpc157 → bpc-157 style already in includes
  const uniq = [];
  for (const n of needles) {
    const v = n.replace(/\s+/g, " ").trim();
    if (v && !uniq.includes(v)) uniq.push(v);
    const compact = v.replace(/-/g, "");
    if (compact !== v && !uniq.includes(compact)) uniq.push(compact);
  }
  return uniq.length ? uniq : ["___nomatch___"];
}
