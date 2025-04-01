import { expect, Locator, Page, test } from "@playwright/test";
import * as fs from "node:fs";
import { addMonths, isBefore, parse } from "date-fns";

const PRODUCER_LIST = [
  "3FE",
  "BONANZA COFFEE",
  "BRACIA ZIÓŁKOWSCY",
  "CASINO MOCCA",
  "COFFEE PLANT",
  "COFFEELAB",
  "DAK COFFEE ROASTERS",
  "DOUBLESHOT",
  "FATHER'S COFFEE",
  "FIGA COFFEE",
  "FIVE ELEPHANT",
  "GARDELLI SPECIALITY COFFEES",
  "GOOD COFFEE",
  "HARD BEANS",
  "HAYB",
  "HERESY",
  "KAFAR",
  "KYOTO",
  "LA CABRA",
  "LYKKE",
  "MAMAM",
  "NOMAD COFFEE",
  "ONYX COFFEE LAB",
  "ROCKET BEAN",
  "SPOJKA",
  "STORY COFFEE ROASTERS",
  "THE COFFEE COLLECTIVE",
];

const FLAVOURS = [
  "owoce cytrusowe",
  "owoce czerwone",
  "owoce leśne",
  "owoce suszone",
  "owoce tropikalne",
  "owoce żółte",
  "przyprawy",
  "słodkie",
];

const confirmCookies = async (page: Page) => {
  const cookieConfirmButton = page.locator(
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  );
  await cookieConfirmButton.click();
};

async function selectFromMultiSelectFilter(
  filterContainer: Locator,
  options: string[],
) {
  await filterContainer.click();
  const availableOptions = await filterContainer.locator("li").all();
  for (const option of availableOptions) {
    if (
      options.includes(((await option.textContent()) ?? "").trim()) &&
      (await option.locator("input").getAttribute("disabled")) == null
    ) {
      await option.locator("label").click();
    }
  }
}

async function filterByProducers(page: Page) {
  const producerDropdown = page.locator(".filter-multi-select-manufacturer");
  await selectFromMultiSelectFilter(producerDropdown, PRODUCER_LIST);
}

async function sortByPrice(page: Page) {
  const sortingDropdown = page.locator(".filter-multi-select-sorting");
  await sortingDropdown.click();
  const priceAscOption = sortingDropdown.getByText("Cena (rosnąco)");
  await priceAscOption.click();
}

async function moreFilters(page: Page) {
  await page.getByText("Więcej filtrów").click();
}

async function setMaxPrice(page: Page) {
  // It's matching CENA and OCENA MIN.
  await (await page.locator(".more-filters-container").getByText("Cena").all())
    .at(0)
    ?.click();
  await page.locator(".form-control.max-input").fill("80");
}

async function setFlavours(page: Page) {
  const flavoursDropdown = page
    .locator(".filter-panel-items-container")
    .getByText("Nuty smakowe");
  await selectFromMultiSelectFilter(flavoursDropdown, FLAVOURS);
}

async function onlyFreshRoast(product: Locator) {
  const roastDateLoc = product.locator(".product-box__roasting-data");
  try {
    if (!(await roastDateLoc.isVisible())) return false;
    const roastDateText = await roastDateLoc.textContent();

    if (!roastDateText) return false;

    const roastDate = parse(
      roastDateText.substring("Data palenia:".length).trim(),
      "dd.MM.yyyy",
      new Date(),
    );

    if (isBefore(roastDate, addMonths(new Date(), -2))) {
      console.log("Roasting date too late: " + roastDate);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function productIsAvailable(product: Locator) {
  return !(await product.locator(".product-detail-not-available").isVisible());
}

async function getAllCoffees(page: Page) {
  return await page.locator(".product-box").all();
}

async function waitForLoaderToDetach(page: Page) {
  await page.locator(".has-element-loader").waitFor({ state: "detached" });
}

async function goToNextPage(page: Page) {
  const nextPageBtn = page.locator(".page-next");
  await nextPageBtn.click();
  await waitForLoaderToDetach(page);
}

async function getAvailableCoffees(allCoffees: Locator[]) {
  return await Promise.all(
    allCoffees.map(
      async (coffee) =>
        [coffee, await productIsAvailable(coffee as Locator)] as [
          Locator,
          boolean,
        ],
    ),
  ).then((coffees) =>
    coffees.filter(([, isAvailable]) => isAvailable).map(([coffee]) => coffee),
  );
}

async function getFreshCoffees(availableCoffees: Locator[]) {
  return await Promise.all(
    availableCoffees.map(
      async (coffee) =>
        [coffee, await onlyFreshRoast(coffee)] as [Locator, boolean],
    ),
  ).then((coffees) =>
    coffees.filter(([, isFresh]) => isFresh).map(([coffee]) => coffee),
  );
}

test("get all interesting coffees", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(
    "https://www.coffeedesk.pl/kawa/metoda-parzenia/przelewowe-metody-parzenia/",
  );
  await page.addStyleTag({
    content: "#snrs-popup-wrapper-ns {display: none !important;}",
  });
  await confirmCookies(page);
  await filterByProducers(page);
  await sortByPrice(page);
  await moreFilters(page);
  await setMaxPrice(page);
  await setFlavours(page);
  await waitForLoaderToDetach(page);

  const listedProductsHrefs = [];

  do {
    const allCoffees = await getAllCoffees(page);
    const availableCoffees = await getAvailableCoffees(allCoffees);
    const freshCoffees = await getFreshCoffees(availableCoffees);
    const freshCoffeesLinks = await Promise.all(
      freshCoffees.map((coffee) =>
        coffee.locator(".product-info a").getAttribute("href"),
      ),
    );

    listedProductsHrefs.push(...freshCoffeesLinks);

    if (allCoffees.length !== availableCoffees.length) {
      break;
    }

    try {
      let nextPageBtn = page.locator(".page-next");
      await expect(nextPageBtn).toBeEnabled();
    } catch (e) {
      break;
    }

    await goToNextPage(page);
  } while (true);

  fs.writeFileSync(
    "./hrefs.txt",
    listedProductsHrefs
      .filter((href) => !/Sie-Przelewa/.test(href ?? ""))
      .filter((href) => !/Coffee-Plant-Flow-/.test(href ?? ""))
      .join("\n"),
  );
});
