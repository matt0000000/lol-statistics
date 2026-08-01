import { toPatchKey } from "@lol/domain";
import {
  championCatalogSchema,
  itemDtoSchema,
  itemCatalogSchema,
  parseRealm,
  type ChampionDto,
  type ItemDto
} from "./contracts";

const TR_REALM_URL = "https://ddragon.leagueoflegends.com/realms/tr.json";

export class DataDragonClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchTrCatalog(): Promise<{
    version: string;
    locale: string;
    champions: Record<string, ChampionDto>;
    items: ItemDto[];
  }> {
    const realm = parseRealm(await this.getJson(TR_REALM_URL));
    // Validate that the realm version has the major/minor shape used by the
    // domain before constructing versioned catalog URLs.
    toPatchKey(realm.dd);
    const base = `${realm.cdn}/${realm.dd}/data/${realm.l}`;
    const champions = championCatalogSchema.parse(await this.getJson(`${base}/champion.json`));
    const items = itemCatalogSchema.parse(await this.getJson(`${base}/item.json`));
    const enrichedItems = Object.entries(items.data).map(([id, item]) =>
      itemDtoSchema.parse({ ...item, id: Number(id) })
    );

    return {
      version: realm.dd,
      locale: realm.l,
      champions: champions.data,
      items: enrichedItems
    };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Data Dragon ${response.status}: ${url}`);
    return response.json();
  }
}
