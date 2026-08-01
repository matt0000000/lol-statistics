import { toPatchKey } from "@lol/domain";
import {
  championCatalogSchema,
  itemDtoSchema,
  itemCatalogSchema,
  parseItemId,
  parseRealm,
  type ChampionDto,
  type ItemDto
} from "./contracts";
import { aliasesFor } from "./aliases";

const TR_REALM_URL = "https://ddragon.leagueoflegends.com/realms/tr.json";

export class DataDragonClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchTrCatalog(): Promise<{
    version: string;
    locale: string;
    champions: Record<string, ChampionDto>;
    items: ItemDto[];
    aliases: Record<number, number>;
  }> {
    const realm = parseRealm(await this.getJson(TR_REALM_URL));
    // Validate that the realm version has the major/minor shape used by the
    // domain before constructing versioned catalog URLs.
    toPatchKey(realm.dd);
    const cdn = new URL(realm.cdn);
    if (cdn.protocol !== "https:" || cdn.hostname !== "ddragon.leagueoflegends.com") {
      throw new Error("Only the official Data Dragon CDN is allowed");
    }
    const base = `${cdn.toString().replace(/\/$/, "")}/${realm.dd}/data/${realm.l}`;
    const champions = championCatalogSchema.parse(await this.getJson(`${base}/champion.json`));
    const items = itemCatalogSchema.parse(await this.getJson(`${base}/item.json`));
    const enrichedItems = Object.entries(items.data).map(([id, item]) =>
      itemDtoSchema.parse({ ...item, id: parseItemId(id) })
    );

    return {
      version: realm.dd,
      locale: realm.l,
      champions: champions.data,
      items: enrichedItems,
      aliases: aliasesFor(realm.dd)
    };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Data Dragon ${response.status}: ${url}`);
    return response.json();
  }
}
