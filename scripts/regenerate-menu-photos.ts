// ═══════════════════════════════════════════════════════
// REGENERATE MENU PHOTOS — curated Unsplash mapping
//
// Replaces every wrong/duplicated/missing menu image with a real
// Unsplash photo from a hand-curated pool. Each item gets a
// unique photo from the pool that best matches its name; pools
// were built up-front via Unsplash search and only free
// (non-Unsplash+) photos are included.
//
// Run:
//   Dry run:  npx tsx scripts/regenerate-menu-photos.ts
//   Apply:    npx tsx scripts/regenerate-menu-photos.ts --apply
//   --force   regenerates even items that already have a unique
//             image (use cautiously — it overwrites editor-uploaded
//             photos too).
//
// Re-run safe. Items keep whatever photo they got on the first
// successful run unless --force.
// ═══════════════════════════════════════════════════════

import "dotenv/config";
import { db } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

// ─── Curated photo pools ───────────────────────────────
//
// Each entry is a list of long-format Unsplash photo IDs
// (the part after "photo-" in https://images.unsplash.com/photo-XXX).
// All confirmed free at the time of curation. Values stay as raw
// IDs so the runtime can build the standard `?w=600&h=450&fit=crop`
// URL that matches the existing seed file's pattern.

const POOLS: Record<string, string[]> = {
  cappuccino: [
    "1503240778100-fd245e17a273", "1534234757579-8ad69d218ad4",
    "1659553653381-d98d2a831b8c", "1706698319512-499cd769990a",
    "1706698319510-4664da2a7b9f", "1706698319504-f3835392b759",
    "1769398449496-2414ea88b441", "1644418663249-c281545eb083",
    "1644418665359-c8da723147b4", "1644418664472-08f57d5a1cf4",
    "1695031517059-89647f474f51", "1766049837542-f013a9b7e8cb",
  ],
  espresso: [
    "1627902511858-6ad7e004fd35", "1601390483714-955fd3066695",
    "1627398621538-918a69017d28", "1650967067872-64902752e046",
    "1650967230398-527595a77e2f", "1650967230545-a5a4c353c54d",
    "1606310553997-7a01e22900ae", "1646257861487-60fa89bef25f",
    "1638216706121-a3a07ede628e", "1627902522056-a923ef87189d",
    "1613559724083-359907cb5cb0", "1716450043897-114fab741b80",
    "1652408771563-85afefbefb9b", "1679055324099-1b19f1d417c2",
    "1700574234796-98b90f182a42",
  ],
  iced_coffee: [
    "1686575669781-74e03080541b", "1641659736749-8bbae305e475",
    "1595520519726-ad903736543c", "1595520519770-15d19939e648",
    "1595520519724-cd81ef8b4df2", "1595520519701-0bc6373ad51b",
    "1598153089960-9c2010f25ba1", "1646406112321-d45605f7ee15",
    "1771210849472-84a07b2e793a", "1767471717029-44be10fbf123",
    "1772030423129-5dfc22c4f213", "1646406112287-6035555cf688",
  ],
  cold_brew: [
    "1561641377-f7456d23aa9b", "1548109327-a412a3828374",
    "1591736889742-0f5091b7e522", "1626436273411-1ab325a2123e",
    "1626436273416-863b8aa237cf", "1626436272908-2684a7cd01e7",
    "1591933940638-d253adcdcb98", "1626436273093-35351f1a7d00",
    "1626436273393-27c3ec1548a9", "1628510502260-43977e781454",
    "1619543028542-45ceda785d9c", "1591736888673-f4460fd279f0",
    "1536638455623-a35d0fa09ab9", "1626868180657-a1240e21ba35",
  ],
  hot_chocolate: [
    "1589402669377-f7ac773e7f84", "1562609291-761ceb928409",
    "1673020431174-0e6c60d0a6c6", "1604936056519-24eab818edcd",
    "1546354810-f7ea00fa0c3a", "1546354819-2764b2f6f412",
    "1692776407516-85718ffee6ca", "1692776406655-24873779e52a",
    "1709744302540-29b35786b816", "1633854013725-c2c4240fd440",
    "1636766082106-1bf8dbad8090", "1550597096-fc94cdeb5034",
    "1746281673841-31a64ca33ef1", "1546532714-b3b2bb049a74",
    "1609269139523-3ef050397e70",
  ],
  tea: [
    "1518881922778-bacb4debc3d7", "1577968897966-3d4325b36b61",
    "1498604636225-6b87a314baa0", "1491720731493-223f97d92c21",
    "1612706965205-7570f423e339", "1557928001-a3cb59b9036f",
    "1652450852307-53646a5a5e19", "1643316798735-187fc442febb",
    "1502225841522-78d18291275e", "1514228742587-6b1558fcca3d",
    "1551051828-9ef7b1303a05", "1589314875269-0a78300506cb",
  ],
  herbal_tea: [
    "1571934811356-5cc061b6821f", "1648455321715-e8ed86188c0e",
    "1514733670139-4d87a1941d55", "1608060563275-a60fb5027f8d",
    "1558160074-4d7d8bdf4256", "1669016948229-a04f1929fca6",
    "1607048255388-b1754f4de872", "1632639521806-cead484cc369",
    "1653937855510-ec3fd2036d98", "1492778297155-7be4c83960c7",
    "1547318114-eff5ea85ede9", "1564890369478-c89ca6d9cde9",
    "1594137052297-e55c3c6b33f9",
  ],
  mint_tea: [
    "1588578606909-db963679a720", "1744659747310-39564f92c25b",
    "1762920738963-002dbf2b4501", "1763907535893-8d7d0edd65f3",
    "1777360444740-9bfd0d0b7b8e", "1637717356730-f7b43e22a3b9",
    "1627435601361-ec25f5b1d0e5", "1630856834627-1db81357ebfd",
    "1625989809251-cea5f4375048", "1555758933-42f41c02c82f",
    "1611497426695-412abe2f287b", "1609486961058-cbfe79e35cbf",
    "1621604634842-eb9c97e2be0e", "1684713580446-3064936df8a4",
  ],
  hibiscus: [
    "1585044540031-080208462dec", "1713084875941-2bb094d81e02",
    "1722771689293-aa38e2b9eef6", "1722771688500-675668889060",
    "1642931885027-46767ae6794f", "1563636680-28d36aeb83a4",
    "1716829587241-8141617316e4", "1675395409706-7bbd0ceb0081",
    "1647101289861-e217b6e787ff", "1665541170419-99fb98bda523",
    "1580527432672-b1d481ca9b37", "1701279949513-914a96946420",
    "1747568720369-40fa4be81c49", "1721103471021-abdff470ba9c",
  ],
  ginger_tea: [
    "1682530016979-3df4128ba004", "1682530016961-19763e9599b9",
    "1682530016867-6fcc63df0cfb", "1682530016992-d8a2f30b6dd6",
    "1682530016907-7cb3ad54338e", "1682530016903-c84a4a7dbd61",
    "1682530203694-0cfcd23a7bbc", "1599496317648-fa82d6c83656",
    "1682530016981-b7e6956e7c2e", "1606695889004-f7850b9bfb81",
    "1682530016814-6a1c1311cd6e", "1682530016940-1a39be2b95ad",
    "1584972921754-25a9c290b6e1",
  ],
  apple_cider: [
    "1505801045160-cf907cca55ad", "1591532668123-cf04fe4d045f",
    "1607352186035-2caa2453b8a7", "1674135597067-480b0f197f07",
    "1639946086828-5d08b24552c5", "1512393144765-a04c69cf4f86",
    "1667059901675-0c29c05fd925", "1710880695389-4f3c220cf7a4",
    "1481455473976-c280ae7c10f9", "1674135597225-4d4fb8763362",
    "1569383549224-4709f3502c94", "1536597680100-ac32d9c5b0e7",
  ],
  sahlab: [
    "1613158510568-224a4f3948d0", "1574149501304-9eb7931b08ff",
    "1725083803128-c9529c2f927f", "1735796788543-c99c460a0800",
    "1732284081090-8880f1e1905b", "1640158614339-17a17b206b91",
    "1776812007560-564da574ba72", "1704530432333-4ab5040ce766",
    "1550252308-87f004632e0a", "1657483203411-d0d74a8d2d7a",
    "1591102118184-9a7957ceb811", "1627902989798-304b80c54692",
    "1677221279334-ec6bf5fbe239", "1653280640978-37f4d057d72f",
    "1581092161557-edc82c7a9af0",
  ],
  mojito: [
    "1619604395920-a16f33192a50", "1619604395382-2c03dbfbbdf8",
    "1619604106998-fa0caf51b3b5", "1718030559037-760f9a80a469",
    "1710988088583-c75166972a40", "1611526741060-64b55f75d5ab",
    "1658950738283-d9d89897dc4a", "1671116810188-335347d68c65",
    "1652284916707-a4db1bc1327c", "1594579903546-853e3c6c3e21",
    "1717250180315-81b49709a74e", "1622322331040-088df8424c89",
    "1567671823828-4272a32ef644", "1588689380558-5211e4b28e8b",
  ],
  cocktail: [
    "1765099271588-9bd5824d24f3", "1655286029130-fdbe73890014",
    "1678406499636-0d44f91a3970", "1594650541713-58495800c908",
    "1613577813903-e9e9bc994cdb", "1761038611985-3cec1b1c086a",
    "1633822760360-9eb8e38eb40a", "1582728338411-6c8d9777e119",
    "1658243860177-a4cf086f7888", "1759308598424-f34b12da5b8c",
    "1678406499232-3b42cfd4dd42", "1678406499696-2a3c4af62f3c",
    "1581510260769-a40cc475d754",
  ],
  milkshake: [
    "1712056407284-c1eda76e7bcd", "1698380999750-f40d3aaa8331",
    "1645516957558-c165fd13be62", "1579954115545-a95591f28bfc",
    "1698381002794-7eb4600f1799", "1696569366617-32c6e34432ee",
    "1662192511709-e75d67367638", "1696487774050-ba56e4b62359",
    "1678712803863-6cd22f6b9dba", "1734747643067-6d4e0f705a00",
    "1767114915915-4433437ac280", "1632175344860-92a70a4215c7",
  ],
  banana_milkshake: [
    "1649103071123-cc879add60d9", "1740637372899-e27569049917",
    "1645878490155-a0dbcd313645", "1602296751147-5a443571d4a9",
    "1602296751198-a29df947b640", "1602296750987-a2bd035f69ce",
    "1602296751206-d611e4b4fe89", "1602296751209-c52fe103377d",
    "1602296751243-2a15fa218cf8", "1602296751203-b9aa27fe9426",
    "1602296751035-fe8c7d0a6328",
  ],
  smoothie: [
    "1622597468666-27cb9cae0e45", "1622597468158-27733896a49d",
    "1622597468620-656aa1f981ea", "1622597468311-592703487650",
    "1622597467836-f3285f2131b8", "1622597467821-df79dcb4f94d",
    "1622597468473-84f65fdc3fc0", "1711968099525-7d17f7759acf",
    "1711968099526-73b6cfba4f88", "1759428981568-9748d27b85c7",
    "1647275485937-890ba327b0ae", "1542444459-b54d41b491c3",
    "1685156328634-e336397c9d38",
  ],
  blueberry: [
    "1563213349-0d93e049f7de", "1662130187270-a4d52c700eb6",
    "1554495644-8ce87fe3e713", "1515846917035-f0dfba0af0f8",
    "1615051976209-46e9dd936f8d", "1511870535127-cfd904aab3a8",
    "1657041381305-12e765b7444f", "1514598466916-4f5ca5d2d7ca",
    "1598814390620-b5eac0ca1dc2", "1623858437211-7caef71bac44",
    "1623858436701-c0ef963300b1", "1592149843263-3ea4aef5c9c6",
  ],
  ice_cream: [
    "1516559828984-fb3b99548b21", "1657225953401-5f95007fc8e0",
    "1707553851664-5985b32734c0", "1673551493011-2b5f771013d4",
    "1673551494246-0ea345ddbf86", "1761281116743-f5112b4c5219",
    "1633881613747-e98695066141", "1570078070382-a8869c07e7b3",
    "1770162939711-1df39eb7f4ab", "1626182767767-ca6edbb7a6c7",
    "1626182767446-91add616d9d0", "1761281112114-f7c357d6db53",
  ],
  chocolate_cake: [
    "1607257882338-70f7dd2ae344", "1678408854004-2f931669eccd",
    "1751125134100-29b16243f196", "1588195538326-c5b1e9f80a1b",
    "1569054819332-fd78aab9d921", "1768326119181-5f3cfe0adb4c",
    "1641424795072-a108a63c4b1c", "1673551490812-eaee2e9bf0ef",
    "1703876086193-5d29f099205c", "1546902189-eaaf09f8e38f",
    "1592041282302-fd621be86aa7", "1677051726759-77ea1a1266d3",
    "1677051726931-ad13d55005b9", "1677051726737-261a345842c5",
    "1585198330882-f32e816d0320",
  ],
  pancake: [
    "1619592982310-7b7d51e4207f", "1763308373589-7d50af854a7a",
    "1543168691-518c24c546ea", "1762353242703-22c848bf01a9",
  ],
  waffle: [
    "1620885993445-fa73c0d9ad21", "1715398068878-ec85eecd44b1",
    "1551198297-e490636298ba", "1660324600100-8ab33325a0f0",
    "1643410281656-738ff591fb9d", "1558896450-9a18ea141933",
    "1588464083058-989751d1a05f", "1668283549114-19a2c2c7f934",
    "1680486083117-505891eddd04", "1599498844007-bc3419bf24a6",
    "1653838049933-872d585b8d81", "1624286017069-e3e645c338c5",
    "1578687257823-7c790b381e43", "1553699950-29a94e732d8d",
  ],
  english_breakfast: [
    "1562413255-16d008a3532b", "1563636247809-c76f873625ee",
    "1768634003098-9d5848d3b93f", "1692742249152-28138a7bf05c",
    "1655979282314-eb45a7d69959", "1588625436591-c6d853288b60",
    "1670275466352-3f17571fae5e", "1588503823575-2744851a4b56",
    "1712746785768-ae8a10f9a0c0", "1693422660551-7063cbae6c1f",
    "1712746785874-13ec700798cc", "1714678760534-e983cc0496c0",
    "1558672367-241cd1a01b16", "1525473233136-080cdd8b7cb2",
    "1669036688433-22e6203f7f93",
  ],
  french_toast: [
    "1688437310008-54045dce5167", "1611338459946-d128da19cb0b",
    "1668283766194-6e989b6487aa", "1573057377537-dbb3a99ac4b9",
    "1688437310162-8eef29fa74b4", "1623593476410-eb984e68bfe1",
    "1763301636080-e2c3ebfebc73", "1776763255323-373bd0e826b5",
    "1762370861019-488fd3b8dbc5", "1762631933929-30bbe1287f35",
    "1649927716646-06a98f5bec77",
  ],
  omelette: [
    "1668283653825-37b80f055b05", "1639669794539-952631b44515",
    "1591114320268-fb3aac361d8e", "1654921715411-a49607858faf",
    "1759216280661-e785edc3922e", "1759216282444-8996a7ab60ef",
    "1766146431872-a4472ccd3889", "1759216278358-cd3d585b9116",
    "1771285119294-96a87cd118ab", "1759216280603-364c7747d354",
    "1595904255693-8e68a097d09f", "1776286952319-53e7320e0cd0",
    "1776596098410-9530499df14d", "1759216280664-0af82adcf592",
  ],
  croissant: [
    "1712723247648-64a03ba7c333", "1703016402680-d12e7dc746d9",
    "1751151856149-5ebf1d21586a", "1737700088850-d0b53f9d39ec",
    "1733754348873-feeb45df3bab", "1769138885103-7d6e2c02fae7",
    "1649542181703-33cc4f373b28", "1724879703317-a2686a97f767",
    "1712723247649-35dda2670f1c", "1623334044303-241021148842",
    "1698899720612-dcbf89481ace", "1713274788399-fe1aeaced159",
    "1605345746984-8ade72b44e00", "1713274784719-28739aefe219",
    "1769259180062-7d80dad65b78",
  ],
  avocado_toast: [
    "1516061821-2ac22e822d3f", "1551888645-5ec881101c3f",
    "1528216142275-f64d7a59d8d5", "1637154199148-62dd57c5b6e0",
    "1725289970943-42bb16982f5d", "1650330144131-84c9ba7661f4",
    "1536974471655-0466120eff7f", "1585688964622-3cfcfa6b272d",
    "1588580265329-6f36615e9b3f", "1572983339498-13c6d585d265",
    "1633204339709-0721e5c20280", "1633204339916-6ddd69d426e9",
  ],
  halloumi: [
    "1772795359931-97a0d72cd0b0", "1763647818263-62a9256f097c",
    "1665145323730-2d1e5f77426c", "1768733992949-5412e330ef03",
  ],
  mango_juice: [
    "1768758533459-e9b99decb605", "1669050198331-9b8c24f8c269",
    "1579760546582-4826b30671a4", "1589581843983-3319d8a4bc5d",
    "1746376138214-1f5b30fbbc10", "1669055110073-6099dcb0a734",
    "1524059626752-fff2312fbfdc", "1741461687210-48f50b7e960a",
    "1704881661177-7747fe663400", "1525904097878-94fb15835963",
    "1707569517904-92b134ff5f69",
  ],
  strawberry_juice: [
    "1662548084410-b471c8a118c9", "1583577612013-4fecf7bf8f13",
    "1621797350487-c8996f886ab1", "1595981235768-d8f466028cd6",
    "1595763603216-41c9e72e41bc", "1595981267035-7b04ca84a82d",
    "1671660470335-7257ea88d1cc", "1641919089328-5d5063828c4f",
    "1768225434164-294075015612", "1762898841702-244e320da5b1",
    "1632032724798-62aa3c7c9e3f",
  ],
  lemon_juice: [
    "1559079810-d5c52f077bee", "1633785587089-30e1d1a512c5",
    "1665990786173-4b343763001e", "1761154056144-bf1650f040c9",
    "1607522154446-86a1b4b90556", "1626167344458-ab762e7a465c",
    "1713720441159-466472b29b54", "1555901113-a5a735a05ef4",
    "1651993737174-6890c1daef5b",
  ],
  watermelon_juice: [
    "1775184528416-e8059cc84a93", "1652031552052-479e67d3b8fa",
    "1652031552030-9c58731b6217", "1719317007092-7b2931aa36b1",
    "1652031552021-50bcc01121a7", "1652031552040-dcbab3ef5cb2",
    "1761594607049-1a5de1ce31b6", "1763741184209-8521419626af",
    "1765188987576-8479a27407d4", "1579503739626-d1cfa5cba7fa",
    "1641211591885-b7a93f958343", "1504406438164-c0e042535100",
    "1706212550133-4c28333f88c6", "1424591093900-514bab956faf",
    "1567587407679-8187b3b972aa",
  ],
  guava_juice: [
    "1622495966087-4b72dd849db7", "1622496030981-e8377ce1ecdd",
    "1617983918440-83e6ff606271", "1616606282597-58232f802888",
    "1626387765635-16d0724b49bf", "1762255523716-9a9e48673c83",
    "1613510213425-8c8b8c401616", "1764072970460-18e1413c9c8a",
    "1754542074591-ea2cd1a7cd72", "1634014154598-f8f50ae6bf2a",
    "1642609367221-38b23025576a",
  ],
  orange_juice: [
    "1641659735894-45046caad624", "1678388450637-5bdc017ea5e7",
    "1719858495112-53f4c078e537", "1719858493257-6a49892ffc4e",
    "1689066117649-0ca9762fc92c", "1614065612682-10dbc3db2b31",
    "1631791956405-4160558d0faf", "1654818117776-9ae6519173d7",
    "1741461532466-bc0abda5cdc4", "1741461544812-9ed4e9dcdd01",
  ],
  apple_juice: [
    "1751967248061-1af555bfd528", "1751967248158-4ada30f24ef3",
    "1628602041346-25218c541397", "1628268909461-ec1eec52a74e",
    "1632931004138-04f5486f6237", "1727989815707-1b9e8f376775",
    "1716834092653-bf887f1f29d6", "1655170119249-2894355bfed2",
    "1727989820806-b89956a54351", "1472982072373-d7bcc196aabc",
    "1565824020138-308f43ad9de7", "1634976245665-799fc4210637",
  ],
  kiwi: [
    "1653102849723-853c4c64985d", "1647275486864-1b29efb0d570",
    "1544510807-78268e067c70", "1544510806-07b18f692386",
    "1544510807-1c0229035e63", "1586878018137-3f972630ae43",
    "1473348229220-66f5e48021f3", "1627930113300-f617717d3a0e",
    "1614178089181-90169bf69ac8", "1738932371862-c1012fa2b470",
    "1653192317862-602bdcbf8363", "1707448830807-e5c08a10be98",
    "1728026526261-1efc71206882",
  ],
  avocado_juice: [
    "1583525999977-2b928def9ab6", "1693042442021-41423615ce89",
    "1541519890052-6a762bb1e481", "1654084982335-d404ccf9c6f5",
    "1516149480752-2bdac539cf9a", "1619317217554-676f0dfddac7",
    "1610622929740-0b489c884e43", "1676976198567-454aac912a69",
    "1502642074847-9afe11995f6b", "1522687297221-2d71f8c50fd5",
    "1680917948181-617ac811684b", "1738598625124-942fdf5e9d62",
    "1632670768100-cbef410a44cf", "1473348164936-13be821e561c",
  ],
  cherry: [
    "1544550070-10a01fb10e8d", "1712001829531-1828ed2b9f2b",
    "1627031956209-e4ad004a47e8", "1627033266055-88a2400f3fe7",
    "1627032340427-45a513ff2477", "1627033266069-c308955b2fea",
    "1685900464809-5edadb95da37", "1640702296640-20dfeee862ad",
    "1568100119528-1c643b709509", "1544409674-2b2e5f1cf248",
    "1632315948192-850c9f925af7", "1558429773-0d5084b445aa",
    "1632315969038-98abe94426c9",
  ],
  coconut: [
    "1645231286309-2beccdfae91c", "1757332051114-ae8c79214cef",
    "1551117281-9ebf84f8bec9", "1773842297845-41b515c19e38",
    "1743947064524-460d8db07f1a", "1743947063589-256d033a50be",
    "1743947063637-e5febe685929", "1770024582904-39bdf2cd2075",
    "1743947064239-ca8bc9f97806", "1743947064090-42a0c657fbdc",
    "1743947064283-7c78936d6ece", "1566109964132-ec243417ca2d",
    "1768981205610-6a41aeb37a22", "1758186989205-20afdf8d2665",
  ],
  soft_drink: [
    "1621687564000-2495018ee08b", "1696729376212-92f8d1777617",
    "1628340650580-0b2ffda8b807", "1635774855317-edf3ee4463db",
    "1613510214658-f1e56b099811", "1614620150352-c89bb3dae31c",
    "1535588926957-dc13fb410d88", "1619719304580-c6f308e5315a",
    "1568657624422-1b8713e79461", "1697747271254-1f82e532260d",
    "1627338348208-dc098cbfca36", "1499095318633-13ba1e186baf",
    "1734605641773-f2755bf7432d", "1761877184692-2165a77f04dc",
  ],
  red_bull: [
    "1613218222876-954978a4404e", "1546527050-7e08a7f44112",
    "1653862493696-f635ffe46b9c", "1620785028101-2e388da4aaa8",
    "1665359045561-609e8ca2e333", "1771720617148-787085316345",
    "1653862493502-ce2a89f1ea49", "1741519735752-86d93daa49f5",
    "1741519735573-993f97d71726", "1766650552941-aaa360ab012c",
    "1765521397861-f6262d668144", "1581993817402-3241ad801215",
    "1581788426976-2f6bea62bdab", "1571358657078-da729968f6b8",
    "1665387271958-b0144e911616", "1574493202181-17762b908dc6",
    "1765383830252-140ab5377fc9", "1507102499630-6f90cf8c8583",
    "1730818876478-71b9f7ef1163", "1765521397576-918e74159509",
  ],
  water: [
    "1629148302952-75d79bb167ad", "1629148629006-3d81ed7e9198",
    "1591719482505-fcde0bdd0ed1", "1601418934026-99fbe94b5f85",
    "1629148308499-00b77cf5a5cc", "1591656927346-5c8e933b966d",
    "1629148298796-c04a8d8a6770", "1621006503266-0dab1a9083f5",
    "1629148282598-f2b6f25df1db", "1601418983950-fcb93022b352",
    "1706648515853-5e60e8143a3c", "1591656938066-cf1dfcb57661",
    "1601418921726-849e6c6e9d6a", "1759987383835-ee23ab7efb5e",
  ],
  pizza: [
    "1599321955726-e048426594af", "1637438333503-5e218b937aef",
    "1637438333468-2ea466032288", "1688149825046-2f01dbcd90ad",
    "1672856398893-2fb52d807874", "1762500956151-92c15bb57695",
    "1617002125368-64d671e9a4cc", "1642786132912-63a6a607ae20",
    "1629740001727-f9ad15f720c4", "1583729269281-5a0e4d39aa09",
    "1771875600059-665063b27d2d", "1773620496832-9b62e8912452",
    "1756361629888-90596c86fd79", "1756361630126-86810862af91",
    "1775039984614-04f13a099489",
  ],
  pasta: [
    "1576698961062-0096e22f1767", "1571175534150-72cd2b5a6039",
    "1712746784067-e9e1bd86c043", "1712746784296-e62c1cc7b1f3",
    "1760390952135-12da7267ff8f", "1693820206774-d4a769355142",
    "1605590955562-be1a5fda4161", "1761545832779-bc0b4290fc5e",
    "1544378730-8b5104b18790", "1685156328697-a0783b3efbe5",
    "1674456720401-1557c76bf72c", "1685156328635-d193547d7118",
    "1685156329688-ffe9c1a99a06", "1644921504851-b8861be402ac",
    "1772059755285-dfbd775b056c",
  ],
  lasagna: [
    "1646077978608-65ed63765302", "1621510456681-2330135e5871",
    "1586197132548-e2e19edf9f89", "1722528074366-05d258aa56ad",
    "1586197079093-d41601d38245", "1586197103709-a0b1f31b76ff",
    "1759409117421-1a64af35f118", "1709429790175-b02bb1b19207",
    "1760390952710-b0e010ec4e50", "1762631883229-95cfb6a063ad",
  ],
  salad: [
    "1620019989479-d52fcedd99fe", "1605034298551-baacf17591d1",
    "1662743086910-38419bbf7f34", "1659027793188-94f711fdb7ef",
    "1649067907464-174b77a64a9e", "1622637103261-ae624e188bd0",
    "1622637012640-83ff490e189f", "1671497408253-1c996a4a1fdd",
    "1622756144420-6877b1b7476e", "1769638913684-87c75872fda7",
    "1609090802574-612df35aaa04", "1757596057470-19d36962705d",
    "1771759441598-0105381b2e70", "1734989175071-fedc119fb52e",
    "1657835838278-b371d0fc454a",
  ],
  soup: [
    "1692776407523-8f3c4678ad36", "1629978444632-9f63ba0eff47",
    "1629978448078-c94a0ab6500f", "1673646961345-045592136147",
    "1775870226585-65e37f70dad7", "1776429054130-480a95531159",
    "1626200949817-4719bd60000b", "1711915408198-9cac70d045c7",
    "1711915408847-ae32b80a3fd0", "1711915408248-e30b20613316",
    "1711915408337-ae6b1207e42d", "1745817078506-bfc70df458b5",
  ],
  burger: [
    "1550984754-8d1b067b0239", "1557723434-b7376b3cec47",
    "1553979459-d2229ba7433b", "1604366247250-b06cf35fc38a",
    "1544794577-7ba77ea55507", "1551987840-f62d9c74ae78",
    "1523473979815-e7b44c446974", "1576843776838-032ac46fbb93",
    "1586540480250-e3a0717298b8", "1582762147076-6d985d99975a",
    "1605789538467-f715d58e03f9", "1603498195855-4f17930ee40b",
    "1598182198871-d3f4ab4fd181", "1572802419224-296b0aeee0d9",
    "1602083566722-8f58f1002fdd",
  ],
  sandwich: [
    "1676300184084-de35d56a9a70", "1712746784291-e29d5d2694d4",
    "1567234669003-dce7a7a88821", "1678969405738-323f9acb3c18",
    "1550304952-9d1e3444f713", "1567234669013-216f3a40e02e",
    "1763647814142-b1eb054d42f1", "1612827788868-c8632040ab64",
    "1655195672061-90c23e3e8026", "1553909489-cd47e0907980",
    "1716834092510-3be5db563920",
  ],
  hummus: [
    "1743674453093-592bed88018e", "1768812910769-d037b90aee77",
    "1767114915974-3481fa23cbb0", "1589926196807-9553aaf96fd6",
    "1669036723270-5534b164e3e1", "1719671341987-894e8a159806",
    "1653557659017-9d42ed705a9a", "1542676303584-c8043a6c7618",
    "1745853930195-0b52a78eb031", "1694700298860-c360e7dac770",
    "1636044996113-58f159578a9d", "1663003259497-acaef31e0e15",
    "1701611516807-1c027db1671c", "1669036725192-f42a2cd8a07a",
    "1603133872497-f29809b750bf",
  ],
  fries: [
    "1682613886162-49f5e074c092", "1688978181542-87a886a16fbe",
    "1717294978892-cef673e1d17b", "1676566399758-51b0d3927d48",
    "1565290538967-a18f519b6cae", "1591805364522-9d563414ee09",
    "1599200119031-ec980e398c76", "1630287189346-7adf950fb834",
    "1589963099822-196152500713", "1542459099-a5df94c67d95",
    "1626403884390-fbba1072ae19", "1710102236029-24794fe74b66",
  ],
  potato_wedges: [
    "1659945045543-7c25baead190", "1661529515642-fef696c86f64",
    "1584269974503-653d2d40c75c", "1762303441992-ab59156602a4",
    "1773620495518-3c066e8aca5f", "1773409297388-04cec95303bb",
    "1760008018988-9a8d0bf45552", "1769214571709-8136855ff6a5",
    "1770117160166-cece70b1f0b0", "1769214570484-77b13c01d807",
    "1681821673008-401d1bcd2675", "1623238913973-21e45cced554",
    "1691442152523-f31ea73d5181",
  ],
  spring_roll: [
    "1768701544400-dfa8ca509d10", "1767469576689-968335dbabb5",
    "1772004839635-77804fbc7729", "1762305195963-735f8bf9cad1",
    "1762631934944-1607dfccfe6b", "1734771308348-ad90bf5835ec",
    "1763750648061-df7db65fb244", "1775148582534-44e3700ed081",
    "1762631884776-e1a2e5cd6d8d", "1766415007387-e4c0a5720733",
    "1772457677598-2dc68bb6f4c8", "1772457677641-394bbc0c20f6",
    "1613135373494-d1f6a77d159b", "1669340781012-ae89fbac9fc3",
    "1665199021085-d6792847a468",
  ],
  calamari: [
    "1762305195844-94479ea6aca4", "1734771219838-61863137b117",
    "1763467940825-d067fb3baf22", "1761314037289-a9d6760eb37d",
    "1751158949988-fcc5c3e3e91f", "1639024469010-44d77e559f7d",
    "1566714562043-df890a1298ba", "1603133872575-9989ab68d24c",
    "1751094069265-a43726832afe", "1581073766947-e8f3ef5393a4",
    "1682264895449-f75b342cbab6", "1696474551305-6b6e1c2af226",
    "1724116380705-d20ca404b47b", "1675377668870-baf9b35763f9",
    "1667362859205-ab9acd99b952",
  ],
  chicken: [
    "1763219802762-1d34ee0907c5", "1564636242997-77953084df48",
    "1663861623497-2151b2bb21fe", "1736952332338-44dc07283462",
    "1753775290395-09e3cb0b6f70", "1670165088604-5a39f5c1be51",
    "1687020835890-b0b8c6a04613", "1657271518639-ce701811dcb4",
    "1598515214211-89d3c73ae83b", "1762631934518-f75e233413ca",
    "1673646960049-2bfb54a22f4e", "1532550907401-a500c9a57435",
  ],
  seafood: [
    "1623345541450-9bf0cbb6faab", "1764925563135-3d461e72345d",
    "1762631178192-f331d9549fc9", "1563379926898-05f4575a45d8",
    "1774248594063-da3116ce3678", "1771342753098-92aa14aa0619",
    "1607375658859-39f31567ce13", "1771342755991-9a731f18e1f1",
    "1632389762435-8c53185e40ae", "1614277786777-b913c78579f7",
    "1702827556487-0a234d6fa5b4", "1739592773896-721756fc4d33",
    "1587000288195-717f21f10888",
  ],
  falafel: [
    "1570131775695-6c74e80fa386", "1542528180-1c2803fa048c",
    "1767114915896-ec0baace7d33", "1772795682257-ccb3ac896e4a",
    "1734772192785-2986a99ce40f", "1774791500971-ddaafd214520",
    "1642783944285-b33b18ef6c3b", "1699435560767-ad4d6b7dbeb2",
    "1763637674539-5ef67d4a4506", "1777315387772-bde80ddce03b",
    "1777221617041-6efbdd68b9ab",
  ],
  oreo: [
    "1657000154417-bcebe78dd105", "1769433509394-5dbc9472428c",
    "1741520735658-55eaae8a472c", "1768537237954-d5d3668884ac",
    "1768537204074-4581dee07c59", "1507750549272-e58742b1df80",
    "1768537204103-aa6fea28aef8", "1627901585027-fac0ffee14ec",
    "1596108005029-8b6b02720dfd", "1589562394190-794fb52f8387",
    "1636037256103-e0f62d4728b0", "1622405361111-d15ca54b946d",
    "1617694076477-701476d1bd29",
  ],
  nutella: [
    "1670405330853-699115d06c64", "1610355073597-b8876a6bc85b",
    "1662143028497-88ddf8bdcb70", "1596041662347-ee96133e24f4",
    "1607124316018-25beec6d0ab3", "1662143029122-bda6c0da0d85",
    "1607596595198-fc4962590401", "1602667686824-8dfefb65faa0",
    "1693835791992-ae0c42f7074d", "1693858326799-3299d7317f69",
    "1618551919718-160e8e761b39", "1615224680529-462e1632e0ac",
    "1615224681563-434f1175a0bc", "1599239053239-8d1c93749938",
    "1561054732-c759a5f79863",
  ],
  caramel: [
    "1729673521080-46c09eb74107", "1674335891384-fc78bbf38db1",
    "1553596235-ec4d55a7c7f4", "1702728109878-c61a98d80491",
    "1702728117204-9f178761b2dd", "1678684277480-ce8094923d2f",
    "1759277513194-fee965299c48", "1702728052103-69473aa7ed77",
    "1772985763762-c079e16deab8", "1759277513341-685b22961658",
    "1606149186228-4e5ac94a742e", "1759277513352-43807c83205a",
    "1759277513345-038ad5a6ac5b",
  ],
  kunafa: [
    "1588027781880-2c213c365001", "1677671862144-1c3e9fcde82b",
    "1664120326188-e7c97fc77eb0", "1669018558662-c2e4f4f3875c",
    "1608196690589-024087419462", "1608196696432-baa735dd7e58",
    "1574810134700-b6ba48d151a0", "1590429853545-48ecfa348c20",
    "1670931356494-564c7aea0926", "1733727161377-6c0d59836b06",
    "1558509927-ca362f7b77be", "1618235749339-bd340dd191ad",
  ],
};

// ─── Pool selection: item name → pool key ─────────────
//
// Order matters. First match wins. More specific keywords come
// before generic ones (e.g. sahlab/banana_milkshake before milkshake).
const POOL_RULES: { rx: RegExp; pool: string }[] = [
  { rx: /sahlab|hummus el sham|umm ?ali/i, pool: "sahlab" },
  { rx: /banana milkshake|banana with milk|banana with caramel/i, pool: "banana_milkshake" },
  { rx: /club sandwich|tuna mayo sandwich|halloumi sandwich|salami sandwich|bacon sandwich|turkey sandwich|sandwich/i, pool: "sandwich" },

  // Coffee family
  { rx: /iced (americano|cappuccino|latte|spanish|mocha)/i, pool: "iced_coffee" },
  { rx: /iced (frappe|frappuccino|caramel|vanilla)/i, pool: "iced_coffee" },
  { rx: /cold brew/i, pool: "cold_brew" },
  { rx: /espresso|piccolo|cortado|macchiato/i, pool: "espresso" },
  { rx: /americano|cappuccino|latte|raf coffee|hazelnut coffee|spanish coffee|french coffee|orange coffee|blue latte|nescafe|nes ?cafe|flat white|mocha/i, pool: "cappuccino" },
  { rx: /turkish coffee/i, pool: "espresso" },
  { rx: /coffee/i, pool: "cappuccino" },

  // Hot chocolate
  { rx: /hot chocolate/i, pool: "hot_chocolate" },

  // Specific cocktails / mocktails
  { rx: /mojito/i, pool: "mojito" },
  { rx: /cocktail|sunrise|sunset|paradise|florida|kiwi mango|orange berry|blue sky|electric soda|neom special/i, pool: "cocktail" },

  // Tea & herbs
  { rx: /hibiscus|karkade/i, pool: "hibiscus" },
  { rx: /ginger/i, pool: "ginger_tea" },
  { rx: /apple cider/i, pool: "apple_cider" },
  { rx: /mint|naana/i, pool: "mint_tea" },
  { rx: /anise|yansoun|mix herbs|herbs?$|herbal/i, pool: "herbal_tea" },
  { rx: /green tea|tea with mint|tea with milk|black tea|bedouin tea|tea flavors|iced tea|ice green tea/i, pool: "tea" },
  { rx: /lemon honey/i, pool: "tea" },
  { rx: /tea\b/i, pool: "tea" },

  // Ice & dessert specifics
  { rx: /ice cream|gelato|scoop/i, pool: "ice_cream" },

  // Per-fruit drinks (juices, smoothies, milkshakes alike)
  { rx: /banana/i, pool: "banana_milkshake" },
  { rx: /strawberry/i, pool: "strawberry_juice" },
  { rx: /mango/i, pool: "mango_juice" },
  { rx: /watermelon/i, pool: "watermelon_juice" },
  { rx: /guava/i, pool: "guava_juice" },
  { rx: /lemon/i, pool: "lemon_juice" },
  { rx: /orange/i, pool: "orange_juice" },
  { rx: /apple/i, pool: "apple_juice" },
  { rx: /avocado/i, pool: "avocado_juice" },
  { rx: /kiwi/i, pool: "kiwi" },
  { rx: /blueberry|mix ?berry|mixed ?berry|berries|berry/i, pool: "blueberry" },
  { rx: /cherry/i, pool: "cherry" },
  { rx: /coconut/i, pool: "coconut" },

  // Sweet flavors
  { rx: /caramel/i, pool: "caramel" },
  { rx: /nutella/i, pool: "nutella" },
  { rx: /oreo|lotus|biscoff/i, pool: "oreo" },
  { rx: /chocolate|cocoa/i, pool: "chocolate_cake" },
  { rx: /vanilla/i, pool: "ice_cream" },

  // Drink form
  { rx: /milkshake/i, pool: "milkshake" },
  { rx: /smoothie/i, pool: "smoothie" },
  { rx: /juice/i, pool: "smoothie" },

  // Energy / soda / water
  { rx: /red ?bull|hammer|monster|energy/i, pool: "red_bull" },
  { rx: /sparkling water|big water|small water|flo water|water/i, pool: "water" },
  { rx: /cherry cola|coke|cola|pepsi|fanta|sprite|7-?up|fayrouz|soda|soft drink/i, pool: "soft_drink" },

  // Mains & sides
  { rx: /pizza|margherita/i, pool: "pizza" },
  { rx: /pasta|spaghet|penne|fettucc|carbonara|alfredo|arrabbi|napol(e|i)tan|seafood pasta|tuna pasta|salmon pasta|chicken red sauce/i, pool: "pasta" },
  { rx: /lasagna/i, pool: "lasagna" },
  { rx: /burger/i, pool: "burger" },
  { rx: /salad|caesar|greek|tabbou/i, pool: "salad" },
  { rx: /soup|broth/i, pool: "soup" },
  { rx: /chicken/i, pool: "chicken" },
  { rx: /shrimp|prawn|seafood|sea ?bass|sea ?bream|salmon|tuna(?! mayo)|fish/i, pool: "seafood" },
  { rx: /calamari|squid|octopus/i, pool: "calamari" },
  { rx: /falafel|kofta|kebab|shawarma/i, pool: "falafel" },
  { rx: /halloumi|cheese|feta/i, pool: "halloumi" },
  { rx: /hummus|baba ?ghan|tahini/i, pool: "hummus" },
  { rx: /spring roll/i, pool: "spring_roll" },
  { rx: /potato wedge|wedges/i, pool: "potato_wedges" },
  { rx: /fries|chips/i, pool: "fries" },

  // Breakfast / bread / dessert
  { rx: /english breakfast/i, pool: "english_breakfast" },
  { rx: /french toast/i, pool: "french_toast" },
  { rx: /avocado toast/i, pool: "avocado_toast" },
  { rx: /toast/i, pool: "avocado_toast" },
  { rx: /omelet|omelette|eggs?|bacon|sausage/i, pool: "omelette" },
  { rx: /breakfast/i, pool: "english_breakfast" },
  { rx: /croissant/i, pool: "croissant" },
  { rx: /pancake/i, pool: "pancake" },
  { rx: /waffle/i, pool: "waffle" },
  { rx: /kunafa|knafeh|baklava|basbousa|qatayef|atayef|halawa|halva/i, pool: "kunafa" },
  { rx: /cake|cheesecake|tiramisu|brownie|lava|dessert|sweet|pudding/i, pool: "chocolate_cake" },

  // Last-resort by category-ish tokens
  { rx: /milk/i, pool: "milkshake" },
];

const CATEGORY_FALLBACK: Record<string, string> = {
  breakfast: "english_breakfast",
  eggs: "omelette",
  "chefs-special": "avocado_toast",
  "fresh-juices": "smoothie",
  "soft-drinks": "soft_drink",
  "ice-cream": "ice_cream",
  milkshakes: "milkshake",
  desserts: "chocolate_cake",
  cocktails: "cocktail",
  "energy-drinks": "red_bull",
  smoothies: "smoothie",
  coffee: "cappuccino",
  "iced-coffee": "iced_coffee",
  "iced-drinks": "iced_coffee",
  "tea-herbs": "tea",
  sahlab: "sahlab",
  extras: "milkshake",
  pizza: "pizza",
  pasta: "pasta",
  salads: "salad",
  starters: "hummus",
  soups: "soup",
  "main-course": "chicken",
  burgers: "burger",
  sandwiches: "sandwich",
};

function poolFor(name: string, categorySlug: string): string {
  for (const { rx, pool } of POOL_RULES) {
    if (rx.test(name)) return pool;
  }
  return CATEGORY_FALLBACK[categorySlug] || "smoothie";
}

function buildImageUrl(longId: string): string {
  return `https://images.unsplash.com/photo-${longId}?w=600&h=450&fit=crop&q=80`;
}

async function main() {
  const items = await db.menuItem.findMany({
    where: { available: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    select: {
      id: true,
      name: true,
      image: true,
      sortOrder: true,
      category: { select: { slug: true, sortOrder: true } },
    },
  });

  const usage = new Map<string, number>();
  for (const i of items) {
    if (!i.image) continue;
    const k = i.image.trim();
    usage.set(k, (usage.get(k) || 0) + 1);
  }

  type Plan = { id: string; name: string; categorySlug: string; pool: string };
  const plan: Plan[] = [];
  for (const item of items) {
    const isMissing = !item.image || item.image.trim() === "";
    const isDuplicated = !isMissing && (usage.get(item.image!.trim()) || 0) > 1;
    if (!isMissing && !isDuplicated && !FORCE) continue;
    plan.push({
      id: item.id,
      name: item.name,
      categorySlug: item.category.slug,
      pool: poolFor(item.name, item.category.slug),
    });
  }

  console.log(`\n${plan.length} items will get a new photo.\n`);

  // Track every long ID we end up using so two items can't share.
  // Pre-seed with currently-unique-image IDs we're keeping.
  const usedIds = new Set<string>();
  for (const i of items) {
    if (!i.image) continue;
    const m = i.image.match(/\/photo-([0-9a-f-]+)\?/i);
    if (m && m[1]) usedIds.add(m[1]);
  }

  // Per-pool consumption cursor so distribution is even.
  const cursor = new Map<string, number>();
  function nextFromPool(poolKey: string): string | null {
    const ids = POOLS[poolKey];
    if (!ids || ids.length === 0) return null;
    let idx = cursor.get(poolKey) ?? 0;
    for (let n = 0; n < ids.length; n++) {
      const candidate = ids[(idx + n) % ids.length];
      if (!usedIds.has(candidate)) {
        cursor.set(poolKey, (idx + n + 1) % ids.length);
        usedIds.add(candidate);
        return candidate;
      }
    }
    return null;
  }

  // Fallback ordering: if the chosen pool is exhausted, try
  // related pools, then anything we have. Prevents a small pool
  // (like "halloumi" with 4 photos) from leaving items unassigned
  // when they share their pool with others.
  const FALLBACK_CHAIN: string[] = [
    "smoothie", "milkshake", "cappuccino", "tea", "salad", "chocolate_cake",
    "english_breakfast", "pizza", "pasta", "burger", "chicken",
  ];

  type Assignment = { id: string; name: string; categorySlug: string; pool: string; longId: string };
  const assignments: Assignment[] = [];
  const failures: Plan[] = [];

  for (const p of plan) {
    let id = nextFromPool(p.pool);
    if (!id) {
      for (const fb of FALLBACK_CHAIN) {
        id = nextFromPool(fb);
        if (id) break;
      }
    }
    if (id) {
      assignments.push({ ...p, longId: id });
    } else {
      failures.push(p);
    }
  }

  console.log(`Assigned: ${assignments.length}/${plan.length}`);
  if (failures.length > 0) {
    console.log(`\nCould not assign (no fresh photo in any pool):`);
    for (const f of failures) console.log(`  · [${f.categorySlug}] ${f.name}`);
  }

  // Show samples grouped by pool.
  console.log("\nAssignments (grouped by pool):");
  const byPool = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!byPool.has(a.pool)) byPool.set(a.pool, []);
    byPool.get(a.pool)!.push(a);
  }
  for (const [pool, list] of byPool) {
    console.log(`\n  ${pool} (${list.length}):`);
    for (const a of list) console.log(`    · ${a.name}`);
  }

  if (!APPLY) {
    console.log("\nDry run — no changes written.");
    console.log("Re-run with --apply to write photos to the database.");
    return;
  }

  const BATCH = 25;
  let done = 0;
  for (let i = 0; i < assignments.length; i += BATCH) {
    const chunk = assignments.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((a) =>
        db.menuItem.update({
          where: { id: a.id },
          data: { image: buildImageUrl(a.longId) },
        }),
      ),
    );
    done += chunk.length;
    process.stdout.write(`  updated ${done}/${assignments.length}\r`);
  }
  console.log(`\nDone — ${done} items updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
