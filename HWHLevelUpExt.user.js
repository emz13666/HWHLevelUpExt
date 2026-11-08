// ==UserScript==
// @name             HWHLevelUpExt
// @name:en          HWHLevelUpExt
// @name:ru          HWHLevelUpExt
// @namespace        HWHLevelUpExt
// @version          1.20
// @description      Extension for HeroWarsHelper - Hero Level Up (Robust)
// @description:ru   Расширение для HeroWarsHelper - Повышение уровня (Надёжное)
// @author           emz13666 with AI
// @license          MIT
// @match            https://www.hero-wars.com/*
// @match            https://www.hero-wars.cn/*
// @match            https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at           document-start
// ==/UserScript==
(async function () {
    await waitForHelper().then((found) => {
        if (!found) {
            console.log('%cObject for extension not found', 'color: red');
            return;
        }
    });

    async function waitForHelper(timeoutMs = 60000, stepMs = 200) {
        for (let waited = 0; waited < timeoutMs; waited += stepMs) {
            if (typeof HWHClasses !== 'undefined') return true;
            await new Promise((r) => setTimeout(r, stepMs));
        }
        return typeof HWHClasses !== 'undefined';
    }

    console.log('%cStart Extension ' + GM_info.script.name + ', v' + GM_info.script.version + ' by ' + GM_info.script.author, 'color: red');

    const { addExtentionName } = HWHFuncs;
    addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);

    const { othersPopupButtons, i18nLangData } = HWHData;
    const { popup, setSaveVal, getSaveVal, I18N, setProgress, hideProgress } = HWHFuncs;

    const log = (m) => console.log('%c[HWH-LevelUp]%c ' + m, 'color:#00ff00;font-weight:bold;', 'color:inherit;');
    const logWarn = (m) => console.log('%c[HWH-LevelUp]%c ' + m, 'color:#ffa500;font-weight:bold;', 'color:inherit;');
    const logError = (m) => console.log('%c[HWH-LevelUp]%c ' + m, 'color:#ff0000;font-weight:bold;', 'color:inherit;');

    const i18nRu = {
        LU_HERO_LEVEL_UP: 'Повысить уровень',
        LU_HERO_LEVEL_UP_TITLE: 'Повысить уровень (точный расчёт)',
        LU_SELECT_HEROES: 'Выберите героев, <br> которым повысить уровень',
        LU_SELECT_ALL_HEROES: '<span style="color:green;"> Все имеющиеся герои </span>',
        LU_SELECT_ALL_HEROES_TITLE: 'Повысить уровень всем героям до вашего уровня',
        LU_HAVE_NO_HEROES: 'У Вас нет героев, которым можно повысить уровень',
        LU_NO_HEROES_SELECTED: 'Не выбрано ни одного героя для повышения уровня',
        LU_NO_POTIONS: 'Нет зелий опыта',
        LU_BUTTON_GO: 'Выполнить',
        LU_HERO_START: 'Прокачка: <span style="color:DeepSkyBlue;font-weight:bold;"> {heroName} </span> (ур. {heroLevel})<br>',
        LU_HERO_MAX_LEVEL: '<span style="color:Yellow;"> Герой уже максимального уровня </span><br>',
        LU_POTIONS_USED: 'Использовано зелий: <span style="color:Lime;font-weight:bold;"> {count} </span><br>',
        LU_HERO_LEVEL_UP_TO: 'Повышен до <span style="color:Lime;font-weight:bold;"> {level} </span> ур.<br>',
        LU_NOT_ENOUGH_POTIONS: '<span style="color:Yellow;"> Зелья закончились.</span><br>',
        LU_FINISH: '<br><span style="color:Lime;font-weight:bold;"> Готово! </span>',
        LU_TOTAL_POTIONS: 'Всего зелий: <span style="color:Lime;font-weight:bold;"> {count} </span>',
        LU_POTIONS_LEFT: 'Осталось: малых {p9} / средних {p10} / больших {p11} / огромных {p12}',
        LU_PROCESSING: 'Обработка...',
        LU_REFRESHING_DATA: 'Обновление данных...',
    };
    i18nLangData['ru'] = Object.assign(i18nLangData['ru'] || {}, i18nRu);
    i18nLangData['en'] = Object.assign(i18nLangData['en'] || {}, i18nRu);

    // --- Константы ---
    // Порядок: от маленьких к большим, чтобы точнее «добивать» остаток
    const XP_POTION_IDS = [9, 10, 11, 12];
    const potionXp = { 9: 500, 10: 1500, 11: 5000, 12: 15000 };

    const MAX_HERO_LEVEL = 130;
    const MAX_HERO_XP = 3625195;            // суммарный XP для 130 ур., совпадает с HWH
    const MAX_PER_REQUEST = 200;            // размер пачки зелий за один запрос
                                            // (если сервер ругнётся на размер — уменьшить до 100 или 50)
    const MAX_FALLBACK_ITERATIONS = 2000;   // защита от зависания fallback-цикла

    othersPopupButtons.push({
        get msg() { return I18N('LU_HERO_LEVEL_UP'); },
        get title() { return I18N('LU_HERO_LEVEL_UP_TITLE'); },
        result: async function () { await onClickHeroLevelUp(); },
        color: 'pink',
    });

    /** Остались ли хоть какие-то зелья в инвентаре. */
    function hasAnyPotions(inventory) {
        return XP_POTION_IDS.some(id => (inventory[id] || 0) > 0);
    }

    /**
     * Достоверный суммарный XP для userLevel или null, если для < 130
     * надёжно определить не удалось (тогда работаем пачками).
     */
    function resolveTargetXp(userLevel, currentXp) {
        if (userLevel >= MAX_HERO_LEVEL) return MAX_HERO_XP;

        try {
            const exp = lib.getData('level')?.hero?.[userLevel]?.exp;
            if (
                typeof exp === 'number' && isFinite(exp) &&
                exp > currentXp &&
                exp > 0 && exp < 100_000_000
            ) {
                return exp;
            }
        } catch (e) {}
        return null;
    }

    /** Отправка пачки зелий с дроблением на куски по MAX_PER_REQUEST. */
    async function sendPotions(heroId, pId, amount) {
        let remaining = amount;
        let sent = 0;
        let chunks = 0;
        while (remaining > 0) {
            const chunk = Math.min(remaining, MAX_PER_REQUEST);
            await Caller.send({
                name: 'consumableUseHeroXp',
                args: { heroId, libId: pId, amount: chunk }
            });
            remaining -= chunk;
            sent += chunk;
            chunks++;
            if (remaining > 0) await new Promise(r => setTimeout(r, 100));
        }
        return { sent, chunks };
    }

    async function getHeroesForLevelUp(userLevel) {
        const heroes = await Caller.send('heroGetAll');
        return Object.values(heroes).filter(h => h.level < userLevel);
    }

    async function getLevelUpSettings() {
        setProgress(I18N('LU_REFRESHING_DATA'), false);
        try {
            await Caller.send(['heroGetAll', 'userGetInfo', 'inventoryGet']);
        } catch (e) {
            logWarn('Ошибка обновления данных: ' + e.message);
        }

        const user = await Caller.send('userGetInfo');
        const userLevel = user.level;
        const heroes = await getHeroesForLevelUp(userLevel);
        hideProgress();

        if (heroes.length === 0) {
            await popup.confirm(I18N('LU_HAVE_NO_HEROES'));
            return false;
        }

        // Проверку наличия зелий убрали: пользователь может открыть список,
        // даже если зелий нет — просто посмотреть, кого можно повышать.

        const saved = getSaveVal('lu_levelUpSettings', {}) || {};
        const selectAllHeroes = saved.selectAllHeroes === true;
        const selectedIds = Array.isArray(saved.selectedHeroIds) ? saved.selectedHeroIds.map(Number) : [];

        const checkboxes = [
            { name: 'selectAllHeroes', label: I18N('LU_SELECT_ALL_HEROES'), title: I18N('LU_SELECT_ALL_HEROES_TITLE'), checked: selectAllHeroes }
        ];
        const heroList = heroes.map(h => ({
            name: String(h.id),
            label: cheats.translate(`LIB_HERO_NAME_${h.id}`) + ` <span style="color:Silver;">(ур. ${h.level}/${userLevel})</span>`,
            checked: selectedIds.includes(h.id),
        })).sort((a, b) => cheats.translate(`LIB_HERO_NAME_${a.name}`).localeCompare(cheats.translate(`LIB_HERO_NAME_${b.name}`)));
        checkboxes.push(...heroList);

        let isConfigInvalid = true;
        let taskList = [];
        while (isConfigInvalid) {
            const answer = await popup.confirm(I18N('LU_SELECT_HEROES'), [
                { msg: I18N('LU_BUTTON_GO'), result: true, color: 'green' },
                { msg: I18N('BTN_CANCEL'), result: false, isCancel: true, color: 'red' },
            ], checkboxes);

            if (!answer) return 'cancel';
            taskList = popup.getCheckBoxes();

            const selAll = taskList.find(t => t.name === 'selectAllHeroes')?.checked === true;
            const anyHero = taskList.some(t => !isNaN(Number(t.name)) && t.name !== 'selectAllHeroes' && t.checked === true);

            if (selAll || anyHero) isConfigInvalid = false;
            else await popup.confirm(I18N('LU_NO_HEROES_SELECTED'));
        }

        const selAll = taskList.find(t => t.name === 'selectAllHeroes')?.checked === true;
        const finalIds = selAll
            ? heroes.map(h => h.id)
            : taskList.filter(t => !isNaN(Number(t.name)) && t.name !== 'selectAllHeroes' && t.checked === true).map(t => Number(t.name));

        setSaveVal('lu_levelUpSettings', { selectAllHeroes: selAll, selectedHeroIds: finalIds });
        return { heroIds: finalIds, userLevel };
    }

    /**
     * Подъём уровня пачками по MAX_PER_REQUEST зелий.
     * Используется, когда точный targetXp неизвестен (userLevel < 130),
     * и как страховка после точного расчёта.
     * Возвращает { used, finalLevel, batches }.
     */
    async function levelUpByBatches(heroId, userLevel, inventory, heroName) {
        let used = 0;
        let stuck = 0;
        let iterations = 0;
        let finalLevel = 0;
        let batches = 0;

        while (iterations++ < MAX_FALLBACK_ITERATIONS) {
            if (!hasAnyPotions(inventory)) { log(`  [${heroName}] зелья кончились`); break; }

            const hs = await Caller.send('heroGetAll');
            const h = hs[heroId];
            if (!h) break;
            finalLevel = h.level;
            if (finalLevel >= userLevel) break;

            // Ищем любое доступное зелье (сначала крупные — быстрее)
            let pId = null;
            for (const id of [12, 11, 10, 9]) {
                if ((inventory[id] || 0) > 0) { pId = id; break; }
            }
            if (!pId) break;

            const batch = Math.min(inventory[pId], MAX_PER_REQUEST);
            try {
                await Caller.send({
                    name: 'consumableUseHeroXp',
                    args: { heroId, libId: pId, amount: batch }
                });
                inventory[pId] -= batch;
                used += batch;
                batches++;
                stuck = 0;
            } catch (err) {
                if (err.message.includes('maximum xp')) {
                    log(`  [${heroName}] сервер: maximum xp — достигнут максимум`);
                    break;
                }
                logError(`  [${heroName}] ошибка пачки: ${err.message}`);
                if (++stuck >= 3) { logError(`  [${heroName}] 3 ошибки подряд — прерываем`); break; }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (iterations % 5 === 0) {
                setProgress(`${heroName}: ур. ${finalLevel} → ${userLevel}, зелий: ${used} (пачек: ${batches})`, false);
            }
        }

        try {
            const h = (await Caller.send('heroGetAll'))[heroId];
            if (h) finalLevel = h.level;
        } catch (e) {}

        return { used, finalLevel, batches };
    }

    async function onClickHeroLevelUp() {
        log('Запуск...');
        try {
            const settings = await getLevelUpSettings();
            if (!settings || settings === 'cancel') return;

            const { heroIds, userLevel } = settings;
            setProgress(I18N('LU_PROCESSING'), false);

            const [heroesData, inventoryData] = await Caller.send(['heroGetAll', 'inventoryGet']);
            const inventory = { ...(inventoryData.consumable || {}) };

            log(`Стартовый инвентарь: 9:${inventory[9]||0} 10:${inventory[10]||0} 11:${inventory[11]||0} 12:${inventory[12]||0}`);
            log(`Размер пачки за один запрос: ${MAX_PER_REQUEST}`);

            // Если зелий нет изначально — предупреждаем и выходим
            if (!hasAnyPotions(inventory)) {
                await popup.confirm(I18N('LU_NO_POTIONS'));
                hideProgress();
                return;
            }

            let totalUsed = 0;
            let totalBatches = 0;
            let message = '';

            for (const heroId of heroIds) {
                // Зелья закончились — дальше нет смысла перебирать героев
                if (!hasAnyPotions(inventory)) {
                    log('Зелья закончились — прерываем обработку оставшихся героев');
                    break;
                }

                const hero = heroesData[heroId];
                if (!hero) continue;

                const heroName = cheats.translate(`LIB_HERO_NAME_${heroId}`);
                let currentLevel = hero.level;

                if (currentLevel >= userLevel) {
                    log(`${heroName} уже ≥ ${userLevel}, пропуск`);
                    continue;
                }

                const currentXp = Math.max(0, hero.xp || 0);
                const targetXp = resolveTargetXp(userLevel, currentXp);

                log(`=== ${heroName}: ур.${currentLevel}/${userLevel}, xp=${currentXp}, targetXp=${targetXp === null ? 'неизвестен' : targetXp} ===`);

                message = I18N('LU_HERO_START', { heroName, heroLevel: currentLevel });
                setProgress(message, false);

                let heroUsed = 0;
                let heroBatches = 0;

                if (targetXp !== null) {
                    // === Точный режим ===
                    let neededXp = Math.max(0, targetXp - currentXp);
                    log(`${heroName}: точный режим, нужно ${neededXp} XP`);

                    if (neededXp === 0) {
                        // По расчёту XP хватает, но уровень ниже — данные разошлись.
                        // Отправим один маленький пакет, чтобы сервер сам синхронизировал.
                        logWarn(`${heroName}: XP хватает по расчёту, но уровень ниже. Пробуем малым пакетом.`);
                        neededXp = potionXp[9];
                    }

                    for (const pId of XP_POTION_IDS) {
                        if (neededXp <= 0 || !hasAnyPotions(inventory)) break;
                        const avail = inventory[pId] || 0;
                        if (avail <= 0) continue;

                        const xpPer = potionXp[pId];
                        const needed = Math.ceil(neededXp / xpPer);
                        const toUse = Math.min(avail, needed);

                        log(`  [${heroName}] зелье ${pId}: нужно ${needed}, используем ${toUse} (${toUse * xpPer} XP)`);

                        try {
                            const { sent, chunks } = await sendPotions(heroId, pId, toUse);
                            inventory[pId] -= sent;
                            heroUsed += sent;
                            totalUsed += sent;
                            heroBatches += chunks;
                            totalBatches += chunks;
                            neededXp -= sent * xpPer;

                            log(`    отправлено ${sent} зелий, пачек по ${MAX_PER_REQUEST}: ${chunks}`);
                        } catch (err) {
                            if (err.message.includes('maximum xp')) {
                                log(`  [${heroName}] сервер: maximum xp — герой достиг максимума`);
                                neededXp = 0;
                                break;
                            }
                            logError(`  [${heroName}] ошибка: ${err.message}`);
                            break;
                        }

                        message = I18N('LU_HERO_START', { heroName, heroLevel: currentLevel });
                        message += I18N('LU_POTIONS_USED', { count: heroUsed });
                        setProgress(message, false);
                    }
                } else {
                    // === Режим пачками (userLevel < 130) ===
                    log(`${heroName}: режим пачками (точный XP неизвестен)`);
                    const res = await levelUpByBatches(heroId, userLevel, inventory, heroName);
                    heroUsed = res.used;
                    heroBatches = res.batches;
                    totalUsed += res.used;
                    totalBatches += res.batches;
                    log(`  [${heroName}] пачками: ${res.used} зелий, пачек: ${res.batches}`);
                }

                // Обновляем данные героя
                try {
                    const h = (await Caller.send('heroGetAll'))[heroId];
                    if (h) currentLevel = h.level;
                } catch (e) {}

                // Если всё ещё ниже цели — добиваем пачками (только если ещё есть зелья)
                if (currentLevel < userLevel && hasAnyPotions(inventory)) {
                    logWarn(`${heroName}: ур.${currentLevel} < ${userLevel}, добиваем пачками`);
                    const res = await levelUpByBatches(heroId, userLevel, inventory, heroName);
                    heroUsed += res.used;
                    totalUsed += res.used;
                    heroBatches += res.batches;
                    totalBatches += res.batches;
                    currentLevel = res.finalLevel;
                    log(`  [${heroName}] добито: ${res.used} зелий, пачек: ${res.batches}`);
                }

                message = I18N('LU_HERO_START', { heroName, heroLevel: currentLevel });
                message += I18N('LU_POTIONS_USED', { count: heroUsed });
                message += currentLevel >= userLevel
                    ? I18N('LU_HERO_LEVEL_UP_TO', { level: userLevel })
                    : I18N('LU_NOT_ENOUGH_POTIONS');
                setProgress(message, false);

                log(`${heroName} финал: ур.${currentLevel}, использовано ${heroUsed} зелий (пачек: ${heroBatches})`);
                await new Promise(r => setTimeout(r, 150));
            }

            message += I18N('LU_FINISH') + '<br>' + I18N('LU_TOTAL_POTIONS', { count: totalUsed });
            message += '<br>' + I18N('LU_POTIONS_LEFT', {
                p9: inventory[9] || 0, p10: inventory[10] || 0,
                p11: inventory[11] || 0, p12: inventory[12] || 0,
            });
            setProgress(message, true, hideProgress);
            log(`Готово. Всего использовано ${totalUsed} зелий (пачек по ${MAX_PER_REQUEST}: ${totalBatches})`);

            // Синхронизацию интерфейса не делаем: UI всё равно не обновляет уровни,
            // а при повторном открытии формы данные перечитываются с сервера.
            // Полноценное обновление произойдёт после перезагрузки игры.

        } catch (error) {
            logError('Критическая: ' + error.message);
            setProgress(`<span style="color:red;">Критическая: ${error.message}</span>`, true, hideProgress);
        }
    }
})();
