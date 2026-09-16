# ULIP API document index

**Do not read the PDFs or the extracted text unless you are changing the catalogue
generator.** `src/data/ulip/catalogue.ts` is generated from these documents and already
carries every endpoint id, parameter, validation regex and example. Reading it is cheaper,
and it is what the code actually uses.

This index exists so you can find the one document that answers a question without
grepping 36 files — 1.3 MB of text, 24 MB of PDF.

- Endpoints in the catalogue: **95**
- Referenced somewhere in the app: **58**

| System | Endpoints | Wired | Ministry | Document |
|---|---|---|---|---|
| `AAICLAS` | 01* 02 | 1/2 | Ministry of Civil Aviation | `ULIP_AAICLAS_Integration_Requirement.txt` |
| `ACMES` | 01* 02 | 1/2 | Ministry of Civil Aviation | `ULIP_ACMES_Integration_Requirement.txt` |
| `AUTHAPI` | 01 02 | 0/2 | Multiple source systems | `—` |
| `BLACKSPOT` | 01* | 1/1 | States & Union Territories | `ULIP_BLACK_SPOT_Integration_Requirement.txt` |
| `BPCL` | 01 02 | 0/2 | Ministry of Petroleum & Natural Gas | `ULIP_BPCL_Integration_Requirement.txt` |
| `CARBON` | 01* 02* 03* 04* | 4/4 | Indian Institute of Management, Bengaluru | `—` |
| `CFSICD` | 01 | 0/1 | NICDC | `—` |
| `DGFT` | 01* 02 | 1/2 | Ministry of Commerce & Industry | `ULIP_DGFT_AUTH_Integration_Requirement.txt` |
| `ECHALLAN` | 01* | 1/1 | Ministry of Road Transport & Highways | `ULIP_ECHALLAN_Integration_Requirement.txt` |
| `EVYATRA` | 01* | 1/1 | Ministry of Power | `ULIP_EVYATRA_Integration_Requirement.txt` |
| `EWAYBILL` | 01* | 1/1 | Ministry of Finance (GSTN/NIC) | `ULIP_EWAYBILL_Integration_Requirement.txt` |
| `FASTAG` | 01* 02* | 2/2 | Ministry of Road Transport & Highways | `ULIP_FASTAG_Integration_Requirement.txt` |
| `FCI` | 01 | 0/1 | Ministry of Consumer Affairs, Food & PD | `ULIP_FCI_Integration_Requirement.txt` |
| `FOIS` | 01* 02* 04 | 2/3 | Ministry of Railways | `ULIP_FOIS_Integration_Requirement.txt` |
| `GATISHAKTI` | 01* 02* 03* 04* 05* | 5/5 | Ministry of Commerce & Industry | `ULIP_GATISHAKTI_Integration_Requirement.txt` |
| `HPCL` | 01 02 | 0/2 | Ministry of Petroleum & Natural Gas | `ULIP_HPCL_Integration_requirement.txt` |
| `ICEGATE` | 01 02* 03* 04* 05* 06 07* 08* 09* 10* 11* 12 13* | 10/13 | Ministry of Finance (CBIC) | `ULIP_ICEGATE_Integration_Requirement.txt` |
| `INDIAPOST` | 01 02 03 04 | 0/4 | Ministry of Communications | `ULIP_INDIA_POST_Integration_Requirement.txt` |
| `IOCL` | 01 02 | 0/2 | Ministry of Petroleum & Natural Gas | `ULIP_IOCL_Integration_Requirement.txt` |
| `IWAI` | 01 02 03* 04* 05* 06 07 08 09* 10* 11* 12* 13* 14 15 | 8/15 | Ministry of Ports, Shipping & Waterways | `ULIP_IWAI_Integration_Requirement.txt` |
| `JIOBP` | 01 | 0/1 | Ministry of Petroleum & Natural Gas | `ULIP_JIOBP_Integration_Document.txt` |
| `KALE` | 01* 02 | 1/2 | Ministry of Civil Aviation | `—` |
| `LDB` | 01* | 1/1 | NICDC | `ULIP_LDB_Integration_Requirement.txt` |
| `MCA` | 03* 04* 05* | 3/3 | Ministry of Corporate Affairs | `ULIP_MCA_Integration_Requirement.txt` |
| `MOPNG` | 01* | 1/1 | Ministry of Petroleum & Natural Gas | `ULIP_MOPNG_Integration_requirement.txt` |
| `NOENTRY` | 01* | 1/1 | States & Union Territories | `ULIP_No_Entry_Integration_Requirement.txt` |
| `PCS` | 01* 02* 03* 04* 05* 06* | 6/6 | Ministry of Ports, Shipping & Waterways | `ULIP_PCS_Integration_Requirement.txt` |
| `PESO` | 01* | 1/1 | Ministry of Commerce & Industry | `ULIP_PESO_Integration_Requirement.txt` |
| `SARATHI` | 01* 02 | 1/2 | Ministry of Road Transport & Highways | `ULIP_SARATHI_Integration_Requirement.txt` |
| `TGSARATHI` | 01 | 0/1 | Ministry of Road Transport & Highways | `ULIP_TGSARATHI_Integration_Requirement.txt` |
| `TGVAHAN` | 01 | 0/1 | Ministry of Road Transport & Highways | `ULIP_TGVAHAN_Integration_Requirement.txt` |
| `TOLL` | 01* | 1/1 | Ministry of Road Transport & Highways | `ULIP_Toll_Charges_Integration_Requirement.txt` |
| `UDYAM` | 01* | 1/1 | Ministry of MSME | `ULIP_UDYAM_Integration_Document.txt` |
| `VAHAN` | 01* 02* 03 04* 05 06 | 3/6 | Ministry of Road Transport & Highways | `ULIP_VAHAN_Integration_Requirement.txt` |
| `WAREHOUSE` | 01 | 0/1 | Ministry of Consumer Affairs, Food & PD | `—` |

`*` marks an endpoint referenced in application code.

## When you actually need a document

- **Adding a new endpoint family** — read that one document's response samples, then
  extend the fixture in `MockAdapter.resolve()` (`src/data/mock/index.ts`).
- **Checking a field name** — grep the single file named above, not the directory.
- **Regenerating the catalogue** — the documents are re-downloadable from goulip.in by
  POSTing the document path to `/portalapi/portal/ulip/v1.0.0/api/docDownload`.

