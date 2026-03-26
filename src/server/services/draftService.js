const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const fedexService = require('./fedexService');
const printPreferenceService = require('./printPreferenceService');
const fedexSettingsService = require('./fedexSettingsService');

const DRAFTS_DIR = process.env.DRAFTS_DIR
    ? path.resolve(process.env.DRAFTS_DIR)
    : path.join(process.cwd(), 'storage', 'drafts');
const DRAFTS_FILE = path.join(DRAFTS_DIR, 'drafts.json');

function ensureDataDirectory() {
    if (!fs.existsSync(DRAFTS_DIR)) {
        fs.mkdirSync(DRAFTS_DIR, { recursive: true });
        logger.info(`Diretorio de drafts criado: ${DRAFTS_DIR}`);
    }
}

function loadDrafts() {
    ensureDataDirectory();

    if (!fs.existsSync(DRAFTS_FILE)) {
        fs.writeFileSync(DRAFTS_FILE, JSON.stringify([], null, 2));
        return [];
    }

    try {
        return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8'));
    } catch (error) {
        logger.error('Erro ao carregar drafts', error.message);
        return [];
    }
}

function saveDrafts(drafts) {
    ensureDataDirectory();
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
}

function sumCommodityValues(commodities) {
    if (!Array.isArray(commodities)) return 0;
    return commodities.reduce((sum, commodity) => sum + (parseFloat(commodity.value) || 0), 0);
}

function parseSourceId(sourceId) {
    if (!sourceId || typeof sourceId !== 'string') {
        return null;
    }

    try {
        return JSON.parse(sourceId);
    } catch {
        return null;
    }
}

function normalizeCurrency(outbound) {
    const rawCurrency = outbound.packageDetails?.currency;
    const destinationCountry = outbound.to?.[0]?.address?.countryCode;

    if (rawCurrency) {
        return rawCurrency === 'BRL' && destinationCountry === 'US' ? 'USD' : rawCurrency;
    }

    return destinationCountry === 'US' ? 'USD' : 'USD';
}

function resolveReferenceValue(draftData, outbound, packageIndex) {
    const sourceId = parseSourceId(draftData?.sourceId);

    return (
        outbound.references?.customerReference ||
        sourceId?.orderNumber ||
        draftData?.draftNumber ||
        `REF-${packageIndex + 1}`
    );
}

function buildTin(number, tinType) {
    if (!number) {
        return [];
    }

    return [{
        number,
        tinType
    }];
}

function buildShipper(outbound) {
    return {
        contact: {
            personName: outbound.from?.contact?.name,
            companyName: outbound.from?.contact?.companyName || 'FedEx Express',
            phoneNumber: outbound.from?.contact?.telephoneNumber,
            emailAddress: outbound.from?.contact?.email
        },
        tins: buildTin(
            outbound.from?.federalTaxId || outbound.from?.taxId,
            'BUSINESS_NATIONAL'
        ),
        address: {
            streetLines: [
                outbound.from?.address?.streetLine1,
                outbound.from?.address?.streetLine2
            ].filter(Boolean),
            city: outbound.from?.address?.city,
            stateOrProvinceCode: outbound.from?.address?.stateOrProvinceCode,
            postalCode: outbound.from?.address?.postalCode,
            countryCode: outbound.from?.address?.countryCode
        }
    };
}

function buildRecipient(outbound) {
    const recipient = outbound.to?.[0];

    if (!recipient) {
        return null;
    }

    return {
        contact: {
            personName: recipient.contact?.name,
            companyName: recipient.contact?.companyName || recipient.contact?.name,
            phoneNumber: recipient.contact?.telephoneNumber,
            emailAddress: recipient.contact?.email
        },
        tins: buildTin(
            recipient.federalTaxId || recipient.taxId,
            recipient.address?.countryCode === 'US' ? 'BUSINESS_NATIONAL' : 'PERSONAL_NATIONAL'
        ),
        address: {
            streetLines: [
                recipient.address?.streetLine1,
                recipient.address?.streetLine2
            ].filter(Boolean),
            city: recipient.address?.city,
            stateOrProvinceCode: recipient.address?.stateOrProvinceCode,
            postalCode: recipient.address?.postalCode,
            countryCode: recipient.address?.countryCode
        }
    };
}

function buildRequestedPackageLineItems(draftData, outbound) {
    const weightUnits = outbound.packageDetails?.weightUnits || 'KG';
    const dimensionUnits = outbound.packageDetails?.dimensionsUnits || 'CM';

    return (outbound.packageDetails?.packageLines || []).map((pkg, index) => ({
        sequenceNumber: index + 1,
        weight: {
            units: weightUnits,
            value: Number(pkg.weight) || 0
        },
        dimensions: {
            length: Number(pkg.dimensions?.length) || 0,
            width: Number(pkg.dimensions?.width) || 0,
            height: Number(pkg.dimensions?.height) || 0,
            units: dimensionUnits
        },
        customerReferences: [
            {
                customerReferenceType: 'CUSTOMER_REFERENCE',
                value: resolveReferenceValue(draftData, outbound, index)
            }
        ]
    }));
}

function buildCommodities(outbound, currency) {
    const weightUnits = outbound.packageDetails?.weightUnits || 'KG';

    return (outbound.commodityInformation?.commodities || []).map((commodity) => ({
        description: commodity.description,
        countryOfManufacture: commodity.countryTerritoryManufacture || 'US',
        harmonizedCode: String(commodity.harmonizedCode || '').replace(/\./g, '') || '00000000',
        quantity: commodity.quantity || 1,
        quantityUnits: commodity.quantityUnit || 'PCS',
        unitPrice: {
            currency,
            amount: Number(commodity.value) || 0
        },
        customsValue: {
            currency,
            amount: Number(commodity.value) || 0
        },
        weight: {
            units: weightUnits,
            value: Number(commodity.weight) || 0
        }
    }));
}

function extractDocumentationUrl(shipmentResponse) {
    return (
        shipmentResponse?.mergedLabelUrl ||
        shipmentResponse?.invoiceUrl ||
        shipmentResponse?.labelUrl ||
        shipmentResponse?.shipmentInfo?.labels?.mergedLabelUrl ||
        shipmentResponse?.shipmentInfo?.labels?.invoiceUrl ||
        shipmentResponse?.shipmentInfo?.labels?.labelUrl ||
        shipmentResponse?.fullResponse?.output?.transactionShipments?.[0]?.shipmentDocuments?.[0]?.url ||
        null
    );
}

function extractShipmentLinks(shipmentResponse) {
    return {
        labelUrl: shipmentResponse?.labelUrl || shipmentResponse?.shipmentInfo?.labels?.labelUrl || null,
        invoiceUrl: shipmentResponse?.invoiceUrl || shipmentResponse?.shipmentInfo?.labels?.invoiceUrl || null,
        mergedLabelUrl: shipmentResponse?.mergedLabelUrl || shipmentResponse?.shipmentInfo?.labels?.mergedLabelUrl || null
    };
}

function extractDraftDocuments(draft) {
    const shipmentResponse = draft?.shipmentResponse || null;
    const shipmentLinks = draft?.shipmentLinks || extractShipmentLinks(shipmentResponse);
    const documentationUrl = draft?.documentationUrl || extractDocumentationUrl(shipmentResponse);
    const additionalDocumentationUrl =
        shipmentLinks?.invoiceUrl ||
        shipmentLinks?.mergedLabelUrl ||
        documentationUrl ||
        null;
    const trackingNumber =
        draft?.shipmentResponse?.trackingNumber ||
        draft?.shipmentResponse?.shipmentInfo?.masterTrackingNumber ||
        null;

    return {
        draftId: draft?.id || null,
        status: draft?.status || null,
        trackingNumber,
        documentationUrl,
        additionalDocumentationUrl,
        documents: {
            labelUrl: shipmentLinks?.labelUrl || null,
            invoiceUrl: shipmentLinks?.invoiceUrl || null,
            mergedLabelUrl: shipmentLinks?.mergedLabelUrl || null
        },
        available: Boolean(
            documentationUrl ||
            shipmentLinks?.labelUrl ||
            shipmentLinks?.invoiceUrl ||
            shipmentLinks?.mergedLabelUrl
        )
    };
}

function extractTrackingNumber(draft) {
    return (
        draft?.shipmentResponse?.trackingNumber ||
        draft?.shipmentResponse?.shipmentInfo?.masterTrackingNumber ||
        draft?.shipmentResponse?.fullResponse?.output?.transactionShipments?.[0]?.masterTrackingNumber ||
        draft?.trackingNumber ||
        null
    );
}

function selectDocumentUrlByType(documents, type = 'preferred') {
    switch (type) {
        case 'label':
            return documents?.documents?.labelUrl || null;
        case 'invoice':
            return documents?.documents?.invoiceUrl || null;
        case 'merged':
            return documents?.documents?.mergedLabelUrl || null;
        case 'additional':
            return documents?.additionalDocumentationUrl || null;
        case 'preferred':
        default:
            return (
                documents?.documentationUrl ||
                documents?.documents?.mergedLabelUrl ||
                documents?.documents?.invoiceUrl ||
                documents?.documents?.labelUrl ||
                null
            );
    }
}

function withAutoPrint(url, enabled = false) {
    if (!enabled || !url) {
        return url || null;
    }

    try {
        const parsedUrl = new URL(url);
        parsedUrl.searchParams.set('autoPrint', 'true');
        return parsedUrl.toString();
    } catch (error) {
        return url;
    }
}

function extractDraftUserId(draftData) {
    return (
        draftData?.outboundShipmentInformation?.bookingDetails?.userId ||
        draftData?.outboundShipmentInformation?.billingDetails?.userId ||
        null
    );
}

function buildLabelSpecification(printPreference) {
    const isThermal = printPreference?.labelFormat === 'thermal';

    if (isThermal) {
        return {
            labelFormatType: 'COMMON2D',
            imageType: 'PDF',
            labelStockType: 'STOCK_4X675'
        };
    }

    return {
        imageType: 'PDF',
        labelStockType: 'PAPER_85X11_TOP_HALF_LABEL'
    };
}

function buildUiFinalizePayload(draftData) {
    if (!draftData?.id) {
        return null;
    }

    return {
        id: draftData.id,
        source: 'SHIPMENT_OVERVIEW',
        print: true,
        manualPrint: true
    };
}

function parseDraftToFedexPayload(draftData, options = {}) {
    logger.info('Iniciando parse do draft');

    const outbound = draftData?.outboundShipmentInformation;

    if (!outbound) {
        throw new Error('outboundShipmentInformation nao encontrado no draft');
    }

    const accountNumber =
        options.accountNumber ||
        outbound.bookingDetails?.account?.value ||
        outbound.billingDetails?.account?.value ||
        process.env.FEDEX_ACCOUNT_NUMBER;

    if (!accountNumber) {
        throw new Error('Numero de conta FedEx nao encontrado no draft');
    }

    const recipient = buildRecipient(outbound);

    if (!recipient) {
        throw new Error('Destinatario nao encontrado no draft');
    }

    const currency = normalizeCurrency(outbound);
    const requestedPackageLineItems = buildRequestedPackageLineItems(draftData, outbound);
    const commodities = buildCommodities(outbound, currency);
    const printPreference = printPreferenceService.normalizePrintPreference(options.printPreference);

    if (!requestedPackageLineItems.length) {
        throw new Error('Nenhum pacote encontrado no draft');
    }

    const payload = {
        labelResponseOptions: 'URL_ONLY',
        accountNumber: {
            value: accountNumber
        },
        requestedShipment: {
            shipper: buildShipper(outbound),
            recipients: [recipient],
            shippingChargesPayment: {
                paymentType: outbound.billingDetails?.billTransportationTo || 'SENDER',
                payor: {
                    responsibleParty: {
                        accountNumber: {
                            value: accountNumber
                        }
                    }
                }
            },
            shipDatestamp: outbound.serviceDetails?.shipDate || new Date().toISOString().split('T')[0],
            pickupType: 'CONTACT_FEDEX_TO_SCHEDULE',
            serviceType: outbound.serviceDetails?.serviceType || 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
            packagingType: outbound.packageDetails?.packageType || 'YOUR_PACKAGING',
            blockInsightVisibility: false,
            labelSpecification: buildLabelSpecification(printPreference),
            shipmentSpecialServices: {
                specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'],
                etdDetail: {
                    attributes: ['POST_SHIPMENT_UPLOAD_REQUESTED'],
                    requestedDocumentTypes: [
                        'COMMERCIAL_INVOICE',
                        'CUSTOM_SHIPMENT_DOCUMENT'
                    ]
                }
            },
            shippingDocumentSpecification: {
                shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
                commercialInvoiceDetail: {
                    customerImageUsages: [
                        {
                            id: 'IMAGE_1',
                            type: 'SIGNATURE',
                            providedImageType: 'SIGNATURE'
                        }
                    ],
                    documentFormat: {
                        docType: 'PDF',
                        stockType: 'PAPER_LETTER'
                    }
                }
            },
            customsClearanceDetail: {
                dutiesPayment: {
                    paymentType: outbound.billingDetails?.billDutiesTo || 'RECIPIENT'
                },
                termsOfSale: outbound.commodityInformation?.invoice?.termsOfSale || 'DDP',
                isDocumentOnly: false,
                totalCustomsValue: {
                    amount: sumCommodityValues(outbound.commodityInformation?.commodities),
                    currency
                },
                commodities
            },
            totalPackageCount: requestedPackageLineItems.length,
            requestedPackageLineItems
        },
        carrierCodes: ['FDXE']
    };

    logger.info('Draft parseado para payload final FedEx', {
        accountNumber,
        packageCount: requestedPackageLineItems.length,
        customerReference: requestedPackageLineItems[0]?.customerReferences?.[0]?.value
    });

    return payload;
}

module.exports = {
    async saveDraft(draftData) {
        try {
            const draft = {
                id: `draft-${Date.now()}`,
                data: draftData,
                status: 'SAVED',
                createdAt: new Date().toISOString(),
                shipmentResponse: null,
                documentationUrl: null
            };

            const drafts = loadDrafts();
            drafts.push(draft);
            saveDrafts(drafts);

            logger.info(`Draft salvo com ID: ${draft.id}`);
            return draft;
        } catch (error) {
            logger.error('Erro ao salvar draft', error.message);
            throw error;
        }
    },

    async getAllDrafts() {
        try {
            const drafts = loadDrafts();
            logger.info(`Total de drafts: ${drafts.length}`);
            return drafts;
        } catch (error) {
            logger.error('Erro ao obter drafts', error.message);
            throw error;
        }
    },

    async getDraftById(draftId) {
        try {
            const drafts = loadDrafts();
            const draft = drafts.find((item) => item.id === draftId);

            if (!draft) {
                throw new Error(`Draft nao encontrado: ${draftId}`);
            }

            return draft;
        } catch (error) {
            logger.error('Erro ao obter draft', error.message);
            throw error;
        }
    },

    async getDraftDocuments(draftId) {
        try {
            const draft = await this.getDraftById(draftId);
            return extractDraftDocuments(draft);
        } catch (error) {
            logger.error('Erro ao obter documentos do draft', error.message);
            throw error;
        }
    },

    async getPreferredDraftDocument(draftId, type = 'preferred', options = {}) {
        try {
            const documents = await this.getDraftDocuments(draftId);
            const url = selectDocumentUrlByType(documents, type);

            if (!url) {
                throw new Error(`Nenhum documento disponivel para o draft: ${draftId} (tipo: ${type})`);
            }

            return {
                ...documents,
                selectedType: type,
                preferredUrl: withAutoPrint(url, options.autoPrint === true)
            };
        } catch (error) {
            logger.error('Erro ao obter documento preferencial do draft', error.message);
            throw error;
        }
    },

    async processDraftAndSendToFedex(draftId, options = {}) {
        try {
            logger.info(`Processando draft: ${draftId}`);
            const draft = await this.getDraftById(draftId);
            const draftUserId = extractDraftUserId(draft.data);
            const storedPrintPreference = draftUserId
                ? printPreferenceService.getByUserId(draftUserId)
                : printPreferenceService.DEFAULT_PRINT_PREFERENCE;
            const fedexSettings = draftUserId
                ? fedexSettingsService.requireSelectedAccountByUserId(
                    draftUserId,
                    options.accountNumber
                )
                : null;
            const printPreference = options.printPreference
                ? printPreferenceService.normalizePrintPreference(options.printPreference)
                : storedPrintPreference;
            const payload = parseDraftToFedexPayload(draft.data, {
                printPreference,
                accountNumber: fedexSettings?.accountNumber
            });
            const shipmentResponse = await fedexService.createShipment(payload, {
                credentials: fedexSettings
                    ? {
                        apiKey: fedexSettings.apiKey,
                        secretKey: fedexSettings.secretKey
                    }
                    : undefined
            });
            const documentationUrl = extractDocumentationUrl(shipmentResponse);
            const shipmentLinks = extractShipmentLinks(shipmentResponse);
            const documents = extractDraftDocuments({
                ...draft,
                shipmentResponse,
                shipmentLinks,
                documentationUrl
            });

            const drafts = loadDrafts();
            const draftIndex = drafts.findIndex((item) => item.id === draftId);

            if (draftIndex > -1) {
                drafts[draftIndex].status = 'SENT_TO_FEDEX';
                drafts[draftIndex].parsedPayload = payload;
                drafts[draftIndex].shipmentResponse = shipmentResponse;
                drafts[draftIndex].shipmentLinks = shipmentLinks;
                drafts[draftIndex].printPreference = printPreference;
                drafts[draftIndex].fedexUserId = draftUserId;
                drafts[draftIndex].fedexUiSync = {
                    finalizePayload: buildUiFinalizePayload(draft.data),
                    finalized: false,
                    finalizedAt: null,
                    disabledReason: 'UI finalization desabilitada para evitar divergencia de tracking entre UI e API'
                };
                drafts[draftIndex].documentationUrl = documentationUrl;
                drafts[draftIndex].processedAt = new Date().toISOString();
                delete drafts[draftIndex].error;
                saveDrafts(drafts);
            }

            return {
                draftId,
                status: 'SUCCESS',
                draftUserId,
                printPreference,
                parsedPayload: payload,
                shipmentResponse,
                shipmentLinks,
                documentationUrl,
                documents
            };
        } catch (error) {
            const drafts = loadDrafts();
            const draftIndex = drafts.findIndex((item) => item.id === draftId);

            if (draftIndex > -1) {
                drafts[draftIndex].status = 'ERROR';
                drafts[draftIndex].error = error.message;
                saveDrafts(drafts);
            }

            logger.error(`Erro ao processar draft ${draftId}`, error.message);
            throw error;
        }
    },

    async markDraftAsFinalizedInUi(draftId, metadata = {}) {
        const drafts = loadDrafts();
        const draftIndex = drafts.findIndex((item) => item.id === draftId);

        if (draftIndex === -1) {
            throw new Error(`Draft nao encontrado: ${draftId}`);
        }

        drafts[draftIndex].fedexUiSync = {
            ...(drafts[draftIndex].fedexUiSync || {}),
            finalized: true,
            finalizedAt: new Date().toISOString(),
            responseStatus: metadata.responseStatus || null
        };

        saveDrafts(drafts);
        return drafts[draftIndex];
    },

    async deleteDraft(draftId) {
        try {
            const drafts = loadDrafts();
            const filteredDrafts = drafts.filter((item) => item.id !== draftId);

            if (filteredDrafts.length === drafts.length) {
                throw new Error(`Draft nao encontrado: ${draftId}`);
            }

            saveDrafts(filteredDrafts);
            logger.info(`Draft deletado: ${draftId}`);

            return { message: 'Draft deletado com sucesso' };
        } catch (error) {
            logger.error('Erro ao deletar draft', error.message);
            throw error;
        }
    },

    markDraftAsCancelledByTrackingNumber(trackingNumber, metadata = {}) {
        const normalizedTrackingNumber = String(trackingNumber || '').trim();

        if (!normalizedTrackingNumber) {
            throw new Error('trackingNumber e obrigatorio');
        }

        const drafts = loadDrafts();
        const draftIndex = drafts.findIndex((item) => extractTrackingNumber(item) === normalizedTrackingNumber);

        if (draftIndex === -1) {
            throw new Error(`Draft nao encontrado para o tracking ${normalizedTrackingNumber}`);
        }

        drafts[draftIndex].status = 'CANCELLED';
        drafts[draftIndex].cancelledAt = new Date().toISOString();
        drafts[draftIndex].cancellation = {
            trackingNumber: normalizedTrackingNumber,
            accountNumber: metadata.accountNumber || null,
            response: metadata.response || null
        };

        saveDrafts(drafts);
        return drafts[draftIndex];
    },

    generateDraftSignature(draftData) {
        const key = `${draftData?.data?.shipper?.email || draftData?.shipper?.email}_${draftData?.data?.recipient?.email || draftData?.recipient?.email}_${draftData?.data?.totalValue || draftData?.totalValue}`;
        return key;
    },

    validateAndRemoveDuplicates() {
        try {
            const drafts = loadDrafts();
            const seen = new Map();
            const unique = [];

            for (let index = drafts.length - 1; index >= 0; index--) {
                const draft = drafts[index];
                const signature = this.generateDraftSignature(draft);

                if (!seen.has(signature)) {
                    seen.set(signature, true);
                    unique.push(draft);
                } else {
                    logger.warn(`Draft duplicado removido: ${draft.id} (assinatura: ${signature})`);
                }
            }

            unique.reverse();

            if (unique.length < drafts.length) {
                saveDrafts(unique);
                logger.info(`${drafts.length - unique.length} draft(s) duplicado(s) removido(s)`);
            }

            return unique;
        } catch (error) {
            logger.error('Erro ao validar duplicatas', error.message);
            return loadDrafts();
        }
    },

    cleanProcessedDrafts(keepHistoricalDrafts = false) {
        try {
            const drafts = loadDrafts();
            const processed = drafts.filter((item) => item.status === 'SENT_TO_FEDEX');
            const unprocessed = drafts.filter((item) => item.status !== 'SENT_TO_FEDEX');

            if (processed.length > 0) {
                if (keepHistoricalDrafts) {
                    const historyFile = path.join(DRAFTS_DIR, 'drafts-history.json');
                    const history = this.loadHistoricalDrafts();
                    history.push(...processed);
                    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
                    logger.info(`${processed.length} draft(s) processado(s) movido(s) para historico`);
                }

                saveDrafts(unprocessed);
                logger.info(`${processed.length} draft(s) processado(s) removido(s) do arquivo ativo`);
            }

            return unprocessed;
        } catch (error) {
            logger.error('Erro ao limpar drafts processados', error.message);
            return loadDrafts();
        }
    },

    loadHistoricalDrafts() {
        try {
            const historyFile = path.join(DRAFTS_DIR, 'drafts-history.json');

            if (!fs.existsSync(historyFile)) {
                return [];
            }

            return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
        } catch (error) {
            logger.error('Erro ao carregar historico', error.message);
            return [];
        }
    },

    async validateDrafts(cleanProcessed = false) {
        try {
            logger.info('Iniciando validacao de drafts');

            const afterDupCheck = this.validateAndRemoveDuplicates();
            let finalDrafts = afterDupCheck;

            if (cleanProcessed) {
                finalDrafts = this.cleanProcessedDrafts(true);
            }

            logger.info(`Validacao concluida. ${finalDrafts.length} draft(s) ativo(s).`);
            return finalDrafts;
        } catch (error) {
            logger.error('Erro na validacao de drafts', error.message);
            throw error;
        }
    },

    parseDraftToFedexPayload,
    extractDraftDocuments,
    selectDocumentUrlByType
};
