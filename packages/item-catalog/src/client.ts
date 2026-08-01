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
    if (realm.l !== "tr_TR") throw new Error("Only the canonical TR Data Dragon locale is allowed");
    // Validate that the realm version has the major/minor shape used by the
    // domain before constructing versioned catalog URLs.
    toPatchKey(realm.dd);
    const cdn = new URL(realm.cdn);
    if (
      !/^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/?$/.test(realm.cdn) ||
      cdn.protocol !== "https:" ||
      cdn.hostname !== "ddragon.leagueoflegends.com" ||
      cdn.username !== "" ||
      cdn.password !== "" ||
      cdn.port !== "" ||
      cdn.search !== "" ||
      cdn.hash !== "" ||
      !/^\/cdn\/?$/.test(cdn.pathname)
    ) {
      throw new Error("Only the official Data Dragon CDN is allowed");
    }
    const base = new URL("/cdn/", "https://ddragon.leagueoflegends.com");
    const catalogUrl = (name: string) =>
      new URL(
        `${encodeURIComponent(realm.dd)}/data/${encodeURIComponent(realm.l)}/${name}.json`,
        base
      ).toString();
    const champions = championCatalogSchema.parse(await this.getJson(catalogUrl("champion")));
    const items = itemCatalogSchema.parse(await this.getJson(catalogUrl("item")));
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
